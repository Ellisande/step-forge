/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CucumberExpression,
  ParameterType,
  ParameterTypeRegistry,
} from "@cucumber/cucumber-expressions";
import { ParsedScenario, ParsedStep } from "../analyzer/types";
import { MergeableWorld } from "../world";
import { globalHookRegistry, HookRegistry, ScenarioHookFn } from "./hooks";
import { RegisteredStep, StepRegistry, StepType } from "./registry";

const keywordToStepType: Record<ParsedStep["effectiveKeyword"], StepType> = {
  Given: "given",
  When: "when",
  Then: "then",
};

/** A registered step paired with its compiled Cucumber expression. */
export interface CompiledStep {
  step: RegisteredStep;
  expression: CucumberExpression;
}

export class UndefinedStepError extends Error {
  constructor(public readonly step: ParsedStep) {
    super(`Undefined step: ${step.effectiveKeyword} ${step.text}`);
    this.name = "UndefinedStepError";
  }
}

export class AmbiguousStepError extends Error {
  constructor(
    public readonly step: ParsedStep,
    public readonly matches: RegisteredStep[]
  ) {
    super(
      `Ambiguous step: "${step.text}" matched ${matches.length} definitions:\n` +
        matches.map(m => `  - ${m.expression}`).join("\n")
    );
    this.name = "AmbiguousStepError";
  }
}

/**
 * Compile a registry's steps into matchable Cucumber expressions **once** per
 * run. The result is reused for every scenario — compilation is pure and depends
 * only on the registry, so recompiling per scenario (as an earlier version did)
 * was wasted work proportional to scenarios × steps.
 */
export function compileRegistry(registry: StepRegistry): CompiledStep[] {
  return registry.all().map(step => {
    // Each step gets its own parameter-type registry (seeded with the
    // built-ins). A parser whose name is already registered — the built-in
    // `{int}`/`{float}`/`{string}`, or a repeat within the same step — reuses
    // that type; a novel name (e.g. `{boolean}`, `{color}`) is registered from
    // the parser's regexp + parse, so matching and coercion happen in one pass.
    const paramRegistry = new ParameterTypeRegistry();
    for (const parser of step.parsers) {
      if (paramRegistry.lookupByTypeName(parser.name)) continue;
      const regexps = Array.isArray(parser.regexp)
        ? parser.regexp
        : [parser.regexp];
      paramRegistry.defineParameterType(
        new ParameterType(parser.name, regexps, null, (value: string) =>
          parser.parse(value)
        )
      );
    }
    return {
      step,
      expression: new CucumberExpression(step.expression, paramRegistry),
    };
  });
}

/**
 * Find the single step definition matching a Gherkin step. Matching is
 * opinionated and strict: the keyword must line up with the step type, exactly
 * one definition must match, and undefined/ambiguous both throw rather than
 * silently skipping (unlike Cucumber's pending/undefined dance).
 */
function matchStep(
  step: ParsedStep,
  compiled: CompiledStep[]
): { step: RegisteredStep; args: unknown[] } {
  const expectedType = keywordToStepType[step.effectiveKeyword];
  const matches: { step: RegisteredStep; args: unknown[] }[] = [];

  for (const { step: def, expression } of compiled) {
    if (def.stepType !== expectedType) continue;
    const result = expression.match(step.text);
    if (result) {
      // The parsers are registered as the expression's parameter types, so the
      // captured values are already coerced (`{int}` → number, `{color}` → the
      // parser's T). `execute` consumes them as-is.
      matches.push({ step: def, args: result.map(a => a.getValue(null)) });
    }
  }

  if (matches.length === 0) throw new UndefinedStepError(step);
  if (matches.length > 1) {
    throw new AmbiguousStepError(
      step,
      matches.map(m => m.step)
    );
  }
  return matches[0];
}

export interface StepResult {
  step: ParsedStep;
  status: "passed" | "failed" | "skipped";
  error?: Error;
  /**
   * Absolute `file:line:column` where the matched step is *defined* (its
   * `.step(...)` call site), for Cucumber-style reporting. Absent when no step
   * matched (undefined/ambiguous) or the step was skipped.
   */
  source?: string;
  durationMs?: number;
}

export interface ScenarioResult {
  scenario: ParsedScenario;
  status: "passed" | "failed";
  steps: StepResult[];
  /**
   * The scenario's first error, if it failed. Usually the same object as the
   * failing step's `error`; for a hook failure there's no step to point at, so
   * this is the only place it surfaces. Reporters read this; the runner never
   * throws it.
   */
  error?: Error;
  /** Wall-clock duration of the whole scenario, in milliseconds. */
  durationMs?: number;
}

/**
 * Run one scenario against a pre-compiled step table. A fresh world is created
 * per scenario (state never leaks between scenarios). On the first failing step
 * the remaining steps are marked skipped, matching Cucumber's execution
 * semantics.
 *
 * Never throws for step or hook failures: it always resolves to a
 * `ScenarioResult` carrying the per-step breakdown and (on failure) the first
 * `error` with a synthetic `.feature` stack frame attached. Callers decide what
 * to do with a failure — the CLI runner reports it, a test-runner adapter can
 * re-throw `result.error`. It still rejects for truly exceptional conditions
 * (e.g. a bug in the engine itself), never for a normal test failure.
 *
 * Pass the compiled table from {@link compileRegistry} once and reuse it across
 * every scenario in the run.
 */
export async function runScenario(
  scenario: ParsedScenario,
  compiled: CompiledStep[],
  makeWorld: () => MergeableWorld<any, any, any>,
  hooks: HookRegistry = globalHookRegistry
): Promise<ScenarioResult> {
  const start = now();
  const world = makeWorld();
  const scenarioInfo = { name: scenario.name, file: scenario.file };
  const steps: StepResult[] = [];
  let failed = false;
  let firstError: Error | undefined;

  const fail = (err: unknown) => {
    if (failed) return;
    failed = true;
    firstError = err instanceof Error ? err : new Error(String(err));
  };

  // before-scenario hooks: a throw here aborts the scenario before any step.
  try {
    for (const hook of hooks.for("scenario", "before")) {
      await (hook.fn as ScenarioHookFn)({ world, scenario: scenarioInfo });
    }
  } catch (err) {
    fail(err);
  }

  for (const step of scenario.steps) {
    if (failed) {
      steps.push({ step, status: "skipped" });
      continue;
    }
    // `source` is captured before `execute` so a failing step still carries its
    // definition location; it stays undefined if matching itself throws
    // (undefined/ambiguous step).
    let source: string | undefined;
    try {
      const { step: def, args } = matchStep(step, compiled);
      source = def.source;
      await def.execute(world, args);
      steps.push({ step, status: "passed", source });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      steps.push({ step, status: "failed", error, source });
      fail(error);
    }
  }

  // after-scenario hooks always run (teardown), even on failure. A hook failure
  // only becomes the scenario's error if nothing else failed first.
  for (const hook of hooks.for("scenario", "after")) {
    try {
      await (hook.fn as ScenarioHookFn)({ world, scenario: scenarioInfo });
    } catch (err) {
      fail(err);
    }
  }

  return {
    scenario,
    status: failed ? "failed" : "passed",
    steps,
    error: firstError,
    durationMs: now() - start,
  };
}

/**
 * Monotonic-ish millisecond clock. `performance.now()` where available (Node &
 * Bun both expose it globally), falling back to `Date.now()`. Kept in one place
 * so timing is consistent across scenarios.
 */
function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
