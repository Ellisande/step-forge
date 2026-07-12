/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Splits the runtime hot path into its two halves so we know where the time
 * actually goes before optimizing further:
 *
 *   A. MATCH   — for each Gherkin step, scan the same-type compiled defs and
 *                run `expression.match(text)` (+ coerce args). No execution.
 *   B. EXECUTE — with every step pre-matched, run only `def.execute(world,args)`
 *                (dependency narrowing + step fn + merge). No matching.
 *
 * It also reports how many step texts are *repeated* (the share a match cache
 * could collapse). Run: bun bench/profile-split.ts
 */
import { addStep } from "../src/common";
import { intParser, stringParser } from "../src/parsers";
import { globalRegistry } from "../src/runtime/registry";
import { compileRegistry } from "../src/runtime/engine";
import type { ParsedStep } from "../src/analyzer/types";
import { BasicWorld } from "../src/world";

const SCENARIOS = Number(process.env.SF_SCENARIOS ?? 3000);
const PARAM_STEPS = 8;
const FILLER_DEFS = 80;
const RUNS = Number(process.env.SF_RUNS ?? 5);

function registerSteps(): void {
  globalRegistry.clear();
  addStep(() => "the system is initialized", "given")(() => ({ init: true }));
  addStep(() => "a base widget exists", "given")(() => ({ g0: "base" }));
  addStep(() => "the cache is warm", "given")(() => ({ g1: true }));
  addStep((name: string) => `a widget named ${name}`, "given", undefined, [
    stringParser,
  ])(({ variables }: any) => ({ widgets: [variables[0]] }));
  addStep((n: number) => `a counter set to ${n}`, "given", undefined, [
    intParser,
  ])(({ variables }: any) => ({ counters: [variables[0]] }));
  addStep(() => "the widget is processed", "when", {
    given: { g0: "required" },
    when: {},
    then: {},
  } as any)(() => ({ results: ["ok"] }));
  addStep(() => "the result should be ok", "then", {
    given: { g0: "required" },
    when: { results: "required" },
    then: {},
  } as any)(() => {});
  addStep(() => "the accumulator should be present", "then", {
    given: { g1: "required" },
    when: {},
    then: {},
  } as any)(() => {});
  for (let i = 0; i < FILLER_DEFS; i++) {
    addStep(() => `filler given number ${i}`, "given")(() => ({}));
  }
}

function s(
  effectiveKeyword: ParsedStep["effectiveKeyword"],
  text: string
): ParsedStep {
  return {
    keyword: effectiveKeyword,
    effectiveKeyword,
    text,
    line: 1,
    column: 1,
  };
}

function buildSteps(): ParsedStep[] {
  const all: ParsedStep[] = [];
  for (let i = 0; i < SCENARIOS; i++) {
    all.push(s("Given", "the system is initialized"));
    all.push(s("Given", "a base widget exists"));
    all.push(s("Given", "the cache is warm"));
    for (let p = 0; p < PARAM_STEPS; p++) {
      all.push(
        p % 2 === 0
          ? s("Given", `a widget named "alpha-${i}-${p}"`)
          : s("Given", `a counter set to ${i * 10 + p}`)
      );
    }
    all.push(s("When", "the widget is processed"));
    all.push(s("Then", "the result should be ok"));
    all.push(s("Then", "the accumulator should be present"));
  }
  return all;
}

const keywordToStepType = {
  Given: "given",
  When: "when",
  Then: "then",
} as const;

async function main(): Promise<void> {
  registerSteps();
  const compiled = compileRegistry(globalRegistry);
  const byType: Record<string, typeof compiled> = {
    given: [],
    when: [],
    then: [],
  };
  for (const c of compiled) byType[c.step.stepType].push(c);

  const steps = buildSteps();
  const texts = new Set(steps.map(st => st.text));
  const repeated = steps.length - texts.size;

  // Pre-resolve every step to its def + args for the EXECUTE-only phase.
  const resolved = steps.map(st => {
    const type = keywordToStepType[st.effectiveKeyword];
    for (const { step: def, expression } of byType[type]) {
      const m = expression.match(st.text);
      if (m) return { def, args: m.map(a => a.getValue(null)) };
    }
    throw new Error(`no match: ${st.text}`);
  });

  const time = async (
    label: string,
    fn: () => void | Promise<void>
  ): Promise<number> => {
    for (let i = 0; i < 2; i++) await fn(); // warmup
    const ts: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      await fn();
      ts.push(performance.now() - t0);
    }
    ts.sort((a, b) => a - b);
    const med = ts[Math.floor(ts.length / 2)];
    console.log(
      `${label.padEnd(28)}: ${med.toFixed(1)} ms (median of ${RUNS})`
    );
    return med;
  };

  // A. Matching only (no execute).
  const matchMs = await time("MATCH (scan + coerce)", () => {
    for (const st of steps) {
      const type = keywordToStepType[st.effectiveKeyword];
      let hit = false;
      for (const { expression } of byType[type]) {
        const m = expression.match(st.text);
        if (m) {
          m.map(a => a.getValue(null));
          hit = true;
        }
      }
      if (!hit) throw new Error("miss");
    }
  });

  // B. Execute only (pre-matched). Fresh world every ~14 steps (per scenario).
  const stepsPerScenario = 3 + PARAM_STEPS + 3;
  const executeMs = await time("EXECUTE (narrow+fn+merge)", async () => {
    let world = new BasicWorld<any, any, any>();
    for (let i = 0; i < resolved.length; i++) {
      if (i % stepsPerScenario === 0) world = new BasicWorld<any, any, any>();
      await resolved[i].def.execute(world, resolved[i].args);
    }
  });

  console.log("---------------------------");
  console.log(`total steps          : ${steps.length}`);
  console.log(
    `unique texts         : ${texts.size}  (repeated: ${repeated}, ${(
      (repeated / steps.length) *
      100
    ).toFixed(0)}%)`
  );
  console.log(
    `defs (given/when/then): ${byType.given.length}/${byType.when.length}/${byType.then.length}`
  );
  console.log(
    `MATCH share          : ${((matchMs / (matchMs + executeMs)) * 100).toFixed(0)}%`
  );
  console.log(
    `EXECUTE share        : ${((executeMs / (matchMs + executeMs)) * 100).toFixed(0)}%`
  );
}

main();
