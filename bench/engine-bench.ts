/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-process benchmark for the runtime hot path — the code that runs
 * `scenarios × steps` times: `matchStep` (engine), `execute` (common.ts,
 * dependency narrowing + merge), and the `BasicWorld` getters/merge (world.ts).
 *
 * It deliberately skips file I/O and Gherkin parsing so the numbers reflect the
 * engine, not the disk. Steps are registered via the real `addStep` (identical
 * to what the builders emit) and driven through `runScenario` against a fresh
 * `BasicWorld` per scenario — exactly the production path.
 *
 * Run:  bun bench/engine-bench.ts            (default sizing)
 *       bun bench/engine-bench.ts --big       (heavier sizing)
 *       SF_SCENARIOS=5000 bun bench/engine-bench.ts
 *
 * The harness asserts every scenario passes: a failed step short-circuits the
 * rest as "skipped" (cheap), which would silently corrupt the timing. If you see
 * "FAIL", the numbers are meaningless — fix the synthetic suite first.
 */
import { addStep } from "../src/common";
import { intParser, stringParser } from "../src/parsers";
import { globalRegistry } from "../src/runtime/registry";
import { compileRegistry, runScenario } from "../src/runtime/engine";
import type { ParsedScenario, ParsedStep } from "../src/analyzer/types";
import { BasicWorld } from "../src/world";

// ---------------------------------------------------------------------------
// Sizing knobs (env-overridable)
// ---------------------------------------------------------------------------
const arg = (name: string, fallback: number): number => {
  const v = process.env[name];
  return v ? Number(v) : fallback;
};
const big = process.argv.includes("--big");
const SCENARIOS = arg("SF_SCENARIOS", big ? 8000 : 3000);
const PARAM_STEPS = arg("SF_PARAM_STEPS", big ? 12 : 8);
const FILLER_DEFS = arg("SF_FILLER_DEFS", big ? 160 : 80);
const MEASURED_RUNS = arg("SF_RUNS", 5);
const WARMUP_RUNS = arg("SF_WARMUP", 2);

// ---------------------------------------------------------------------------
// Step definitions — registered once into globalRegistry via the real addStep.
// A mix of plain + parameterized steps, real dependencies, and array-concat
// merges so state grows across a scenario (stresses the world getters/merge).
// ---------------------------------------------------------------------------
function registerSteps(): void {
  globalRegistry.clear();

  // Common "background" givens — reused verbatim in every scenario. Set scalar
  // keys once (fresh world per scenario) and seed the growing `acc` array.
  addStep(
    () => "the system is initialized",
    "given"
  )(() => ({
    init: true,
    acc: [0],
  }));
  addStep(
    () => "a base widget exists",
    "given"
  )(() => ({
    g0: "base",
    acc: [1],
  }));
  addStep(() => "the cache is warm", "given")(() => ({ g1: true, acc: [2] }));

  // Parameterized givens — same text, varying args across scenarios. Append to
  // arrays only (array-concat merge is safe and grows state).
  addStep((name: string) => `a widget named ${name}`, "given", undefined, [
    stringParser,
  ])(({ variables }: any) => ({ widgets: [variables[0]], acc: [3] }));

  addStep((n: number) => `a counter set to ${n}`, "given", undefined, [
    intParser,
  ])(({ variables }: any) => ({ counters: [variables[0]], acc: [4] }));

  // A when + then that depend on background-produced keys (always present), so
  // the dependency-narrowing + require path in `execute` is exercised.
  addStep(() => "the widget is processed", "when", {
    given: { g0: "required" },
    when: {},
    then: {},
  } as any)(() => ({ results: ["ok"] }));

  addStep(() => "the result should be ok", "then", {
    given: { g0: "required" },
    when: { results: "required" },
    then: {},
  } as any)(() => {
    /* assertion-only, returns void */
  });

  addStep(() => "the accumulator should be present", "then", {
    given: { g1: "required" },
    when: {},
    then: {},
  } as any)(() => {
    /* void */
  });

  // Filler defs never referenced by scenarios — they only inflate the number of
  // definitions `matchStep` must scan per Gherkin step (the O(defs) cost).
  for (let i = 0; i < FILLER_DEFS; i++) {
    addStep(() => `filler given number ${i}`, "given")(() => ({}));
  }
}

// ---------------------------------------------------------------------------
// Synthetic scenarios — built as ParsedScenario objects directly.
// ---------------------------------------------------------------------------
function step(
  effectiveKeyword: ParsedStep["effectiveKeyword"],
  text: string,
  line: number
): ParsedStep {
  return { keyword: effectiveKeyword, effectiveKeyword, text, line, column: 1 };
}

function buildScenarios(): ParsedScenario[] {
  const scenarios: ParsedScenario[] = [];
  for (let s = 0; s < SCENARIOS; s++) {
    const steps: ParsedStep[] = [
      step("Given", "the system is initialized", 1),
      step("Given", "a base widget exists", 2),
      step("Given", "the cache is warm", 3),
    ];
    let line = 4;
    for (let p = 0; p < PARAM_STEPS; p++) {
      // Alternate a quoted-string given and an int given, varying the value.
      if (p % 2 === 0) {
        steps.push(step("Given", `a widget named "alpha-${s}-${p}"`, line++));
      } else {
        steps.push(step("Given", `a counter set to ${s * 10 + p}`, line++));
      }
    }
    steps.push(step("When", "the widget is processed", line++));
    steps.push(step("Then", "the result should be ok", line++));
    steps.push(step("Then", "the accumulator should be present", line++));
    scenarios.push({
      name: `scenario ${s}`,
      file: "bench://synthetic.feature",
      line: 1,
      steps,
      tags: [],
    });
  }
  return scenarios;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function runOnce(
  scenarios: ParsedScenario[],
  compiled: ReturnType<typeof compileRegistry>
): Promise<{ ms: number; passed: number; steps: number }> {
  const t0 = performance.now();
  let passed = 0;
  let stepCount = 0;
  for (const scenario of scenarios) {
    const result = await runScenario(
      scenario,
      compiled,
      () => new BasicWorld<any, any, any>()
    );
    if (result.status === "passed") passed++;
    stepCount += result.steps.length;
  }
  return { ms: performance.now() - t0, passed, steps: stepCount };
}

function stats(xs: number[]): { min: number; median: number; mean: number } {
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return { min: sorted[0], median, mean };
}

async function main(): Promise<void> {
  registerSteps();
  const scenarios = buildScenarios();
  const compiled = compileRegistry(globalRegistry);
  const totalDefs = globalRegistry.all().length;
  const stepsPerScenario = scenarios[0].steps.length;
  const totalSteps = SCENARIOS * stepsPerScenario;

  // Warmup — JIT + allocation shape stabilization.
  for (let i = 0; i < WARMUP_RUNS; i++) await runOnce(scenarios, compiled);

  // Correctness gate: every scenario must pass, or the timing is bogus.
  const check = await runOnce(scenarios, compiled);
  if (check.passed !== SCENARIOS) {
    console.error(
      `FAIL: ${check.passed}/${SCENARIOS} scenarios passed — synthetic suite is broken, timings are meaningless.`
    );
    process.exit(1);
  }

  const runs: number[] = [];
  for (let i = 0; i < MEASURED_RUNS; i++) {
    runs.push((await runOnce(scenarios, compiled)).ms);
  }
  const { min, median, mean } = stats(runs);

  console.log("step-forge engine benchmark");
  console.log("---------------------------");
  console.log(`scenarios          : ${SCENARIOS}`);
  console.log(`steps/scenario     : ${stepsPerScenario}`);
  console.log(`total step execs   : ${totalSteps}`);
  console.log(`step definitions   : ${totalDefs}`);
  console.log(
    `match attempts ~   : ${(totalSteps * totalDefs).toLocaleString()}`
  );
  console.log(
    `measured runs      : ${MEASURED_RUNS} (after ${WARMUP_RUNS} warmup)`
  );
  console.log("---------------------------");
  console.log(`min    : ${min.toFixed(1)} ms`);
  console.log(`median : ${median.toFixed(1)} ms`);
  console.log(`mean   : ${mean.toFixed(1)} ms`);
  console.log(
    `steps/sec (median) : ${Math.round(totalSteps / (median / 1000)).toLocaleString()}`
  );
}

main();
