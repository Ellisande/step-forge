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
interface CompiledStep {
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

function compile(registry: StepRegistry): CompiledStep[] {
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
  durationMs?: number;
}

export interface ScenarioResult {
  scenario: ParsedScenario;
  status: "passed" | "failed";
  steps: StepResult[];
}

/**
 * Run one scenario against a registry. A fresh world is created per scenario
 * (state never leaks between scenarios). On the first failing step the
 * remaining steps are marked skipped, matching Cucumber's execution semantics.
 *
 * Throws on failure so it maps cleanly onto a test runner's `test()` body, but
 * the returned/attached `ScenarioResult` carries the per-step breakdown.
 */
export async function runScenario(
  scenario: ParsedScenario,
  registry: StepRegistry,
  makeWorld: () => MergeableWorld<any, any, any>,
  hooks: HookRegistry = globalHookRegistry
): Promise<ScenarioResult> {
  const compiled = compile(registry);
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
    try {
      const { step: def, args } = matchStep(step, compiled);
      await def.execute(world, args);
      steps.push({ step, status: "passed" });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      steps.push({ step, status: "failed", error });
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

  const result: ScenarioResult = {
    scenario,
    status: failed ? "failed" : "passed",
    steps,
  };

  if (failed && firstError) {
    // Surface the failing Gherkin line as a real stack frame so the runner
    // renders a code frame from the `.feature` file itself. Hook failures have
    // no step to point at, so they surface with their own stack unchanged.
    const failing = steps.find(s => s.status === "failed");
    if (failing) attachFeatureFrame(firstError, scenario.file, failing.step);
    throw firstError;
  }

  return result;
}

/**
 * Prepend a synthetic stack frame pointing at the failing Gherkin step. Because
 * the frame's file is the real `.feature` on disk, the test runner treats it as
 * a source location and shows a code frame at the step — instead of us jamming
 * `file:line` into the error message. The frame goes *above* the real stack, so
 * the step-definition frames (the actual throw site) are preserved below it.
 */
function attachFeatureFrame(
  error: Error,
  file: string,
  step: ParsedStep
): void {
  const label = `${step.effectiveKeyword} ${step.text}`;
  const frame = `    at ${label} (${file}:${step.line}:${step.column})`;
  const stack = error.stack;
  if (!stack) {
    error.stack = `${error.name}: ${error.message}\n${frame}`;
    return;
  }
  // A message can span multiple lines, so split on the first frame marker
  // rather than the first newline to find where the header ends.
  const firstFrame = stack.indexOf("\n    at ");
  if (firstFrame === -1) {
    error.stack = `${stack}\n${frame}`;
  } else {
    error.stack =
      stack.slice(0, firstFrame) + `\n${frame}` + stack.slice(firstFrame);
  }
}
