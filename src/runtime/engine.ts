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
 * Which definition a `(stepType, text)` pair resolves to. Computed by scanning
 * the candidate bucket once, then cached (see {@link indexFor}): matching is the
 * dominant runtime cost (a full ambiguity-safe scan of every same-type
 * definition per step), and step text repeats heavily across a run — Background
 * steps re-run per scenario, and any shared phrasing recurs. `"hit"` keeps the
 * winning `expression` so a cached step re-derives its args with a single
 * `.match` instead of re-scanning every definition.
 */
type MatchOutcome =
  | { kind: "hit"; def: RegisteredStep; expression: CucumberExpression }
  | { kind: "undefined" }
  | { kind: "ambiguous"; matches: RegisteredStep[] };

/**
 * The literal first word an expression is *anchored* on, or `null` if it can't
 * be safely determined. Because a `CucumberExpression` matches the whole step
 * text (`^…$`), an expression that begins with a plain literal word followed by
 * a space (or end of string) can only match text whose first token is exactly
 * that word — which lets us index by it and skip the rest. We return `null`
 * (→ "always scan") the moment anything makes that unsound:
 *
 * - starts with a parameter `{…}`, optional `(…)`, or alternation `a/an`;
 * - a special char adjacent to the word with no space (`add{int}`, `item(s)`,
 *   `a/an`) — the matched text's first token would then differ from the word;
 * - starts with an escape `\` or any non-word character.
 *
 * Conservative by construction: a `null` never loses a match, it only forgoes
 * pruning. False positives are harmless too — a wrongly-included candidate just
 * fails its own `.match`.
 */
function anchorToken(expression: string): string | null {
  let i = 0;
  while (i < expression.length) {
    const c = expression[i];
    if (
      c === " " ||
      c === "{" ||
      c === "}" ||
      c === "(" ||
      c === ")" ||
      c === "/" ||
      c === "\\"
    ) {
      break;
    }
    i++;
  }
  if (i === 0) return null; // begins with a space or a special char
  const next = expression[i]; // the char that stopped the scan (or undefined)
  if (next === undefined || next === " ") return expression.slice(0, i);
  return null; // a special char abuts the word — first token is not fixed
}

/** The first whitespace-delimited token of a step's text. */
function firstToken(text: string): string {
  const space = text.indexOf(" ");
  return space === -1 ? text : text.slice(0, space);
}

/**
 * Candidate definitions of one step type, indexed for fast per-step lookup.
 * `byAnchor` maps an anchor token to the definitions that require it; `unanchored`
 * holds the ones that could match any first token (parameters/alternation/etc.)
 * and so must always be scanned. A step's candidate set is `byAnchor.get(token)`
 * plus `unanchored` — a small slice of the bucket, not the whole thing.
 */
interface TypeIndex {
  byAnchor: Map<string, CompiledStep[]>;
  unanchored: CompiledStep[];
}

/**
 * Per-run index over a compiled table: per-step-type candidate indexes, plus a
 * memoized `(type, text) → outcome` match cache. Both are built once and
 * memoized against the compiled array's identity, which is stable for a whole
 * run (one `compileRegistry` call), so every scenario shares them.
 */
interface CompiledIndex {
  types: Record<StepType, TypeIndex>;
  cache: Map<string, MatchOutcome>;
}
const indexCache = new WeakMap<CompiledStep[], CompiledIndex>();
function indexFor(compiled: CompiledStep[]): CompiledIndex {
  let index = indexCache.get(compiled);
  if (!index) {
    const types: Record<StepType, TypeIndex> = {
      given: { byAnchor: new Map(), unanchored: [] },
      when: { byAnchor: new Map(), unanchored: [] },
      then: { byAnchor: new Map(), unanchored: [] },
    };
    for (const c of compiled) {
      const ti = types[c.step.stepType];
      const anchor = anchorToken(c.step.expression);
      if (anchor === null) {
        ti.unanchored.push(c);
      } else {
        const bucket = ti.byAnchor.get(anchor);
        if (bucket) bucket.push(c);
        else ti.byAnchor.set(anchor, [c]);
      }
    }
    index = { types, cache: new Map() };
    indexCache.set(compiled, index);
  }
  return index;
}

/**
 * The definitions that could match `text` for a step type: those anchored on the
 * text's first token, plus the always-scan `unanchored` ones. Sound because an
 * anchored definition can only match text whose first token is its anchor.
 */
function candidatesFor(index: TypeIndex, text: string): CompiledStep[] {
  const anchored = index.byAnchor.get(firstToken(text));
  if (!anchored) return index.unanchored;
  if (index.unanchored.length === 0) return anchored;
  return anchored.concat(index.unanchored);
}

/**
 * Scan candidate definitions for one matching `text`. Opinionated and strict:
 * exactly one definition must match; zero is `undefined`, more than one is
 * `ambiguous`. Every candidate is scanned (a match found early can still be
 * ambiguous with a later one), which is why the result is worth caching per
 * unique text.
 */
function resolveMatch(candidates: CompiledStep[], text: string): MatchOutcome {
  let hit: { def: RegisteredStep; expression: CucumberExpression } | undefined;
  let ambiguous: RegisteredStep[] | undefined;
  for (const { step: def, expression } of candidates) {
    if (expression.match(text)) {
      if (!hit) hit = { def, expression };
      else (ambiguous ??= [hit.def]).push(def);
    }
  }
  if (ambiguous) return { kind: "ambiguous", matches: ambiguous };
  if (!hit) return { kind: "undefined" };
  return { kind: "hit", def: hit.def, expression: hit.expression };
}

/**
 * Find the single step definition matching a Gherkin step. Matching is
 * opinionated and strict: the keyword must line up with the step type, exactly
 * one definition must match, and undefined/ambiguous both throw rather than
 * silently skipping (unlike Cucumber's pending/undefined dance).
 *
 * The `(type, text)` resolution is cached across the run, so a repeated step
 * text scans the definitions only once. Args are re-derived from the winning
 * expression on every call (a single `.match`), never cached — so a step that
 * mutates one of its captured values can't leak that mutation into a later
 * scenario that happens to share the step text.
 */
function matchStep(
  step: ParsedStep,
  compiled: CompiledStep[]
): { step: RegisteredStep; args: unknown[] } {
  const expectedType = keywordToStepType[step.effectiveKeyword];
  const { types, cache } = indexFor(compiled);
  const key = `${expectedType} ${step.text}`;

  let outcome = cache.get(key);
  if (!outcome) {
    const candidates = candidatesFor(types[expectedType], step.text);
    outcome = resolveMatch(candidates, step.text);
    cache.set(key, outcome);
  }

  if (outcome.kind === "undefined") throw new UndefinedStepError(step);
  if (outcome.kind === "ambiguous") {
    throw new AmbiguousStepError(step, outcome.matches);
  }
  // The parsers are registered as the expression's parameter types, so the
  // captured values come back already coerced (`{int}` → number, `{color}` →
  // the parser's T). `execute` consumes them as-is.
  const result = outcome.expression.match(step.text)!;
  return { step: outcome.def, args: result.map(a => a.getValue(null)) };
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
