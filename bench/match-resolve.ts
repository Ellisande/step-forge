/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Measures the *cold resolve* path — what `matchStep` does on a cache miss:
 * scanning candidate definitions and running `expression.match`. The run-wide
 * match cache hides this in the end-to-end bench (one compiled table, reused
 * across runs → warm cache), so this isolates it with all-unique step texts.
 *
 * A/Bs two candidate-selection strategies over the SAME compiled defs:
 *   FULL    — scan every same-type definition (pre-indexing behaviour).
 *   INDEXED — scan only defs anchored on the text's first token + unanchored
 *             ones (the `anchorToken`/`candidatesFor` strategy in engine.ts).
 *
 * The `anchor*` helpers are duplicated here on purpose so the bench doesn't
 * force those internals to be exported. Run: bun bench/match-resolve.ts
 */
import { CucumberExpression } from "@cucumber/cucumber-expressions";
import { addStep } from "../src/common";
import { intParser, stringParser } from "../src/parsers";
import { globalRegistry } from "../src/runtime/registry";
import { compileRegistry } from "../src/runtime/engine";

const FILLER_DEFS = Number(process.env.SF_FILLER_DEFS ?? 80);
const TEXTS = Number(process.env.SF_TEXTS ?? 40000);
const RUNS = Number(process.env.SF_RUNS ?? 5);

type Compiled = { expression: CucumberExpression; expr: string };

// --- duplicated (intentionally) from engine.ts, kept in sync by the tests ----
function anchorToken(expression: string): string | null {
  let i = 0;
  while (i < expression.length) {
    const c = expression[i];
    if ("{}()/\\ ".includes(c)) break;
    i++;
  }
  if (i === 0) return null;
  const next = expression[i];
  if (next === undefined || next === " ") return expression.slice(0, i);
  return null;
}
function firstToken(text: string): string {
  const s = text.indexOf(" ");
  return s === -1 ? text : text.slice(0, s);
}

function register(): void {
  globalRegistry.clear();
  // A spread of realistic given defs with varied leading words (anchors).
  addStep((n: string) => `a user named ${n}`, "given", undefined, [
    stringParser,
  ])(() => ({}));
  addStep((n: string) => `a product called ${n}`, "given", undefined, [
    stringParser,
  ])(() => ({}));
  addStep((n: number) => `an order for ${n} items`, "given", undefined, [
    intParser,
  ])(() => ({}));
  addStep((n: number) => `the cart has ${n} items`, "given", undefined, [
    intParser,
  ])(() => ({}));
  addStep((n: number) => `the inventory shows ${n} units`, "given", undefined, [
    intParser,
  ])(() => ({}));
  addStep((n: string) => `I select ${n}`, "given", undefined, [stringParser])(
    () => ({})
  );
  // Filler defs (anchor "filler") — the bulk, as in a large real suite.
  for (let i = 0; i < FILLER_DEFS; i++) {
    addStep((n: number) => `filler step ${i} value ${n}`, "given", undefined, [
      intParser,
    ])(() => ({}));
  }
}

// All-unique texts spread across the six real defs (never the fillers).
function buildTexts(): string[] {
  const out: string[] = [];
  for (let i = 0; i < TEXTS; i++) {
    switch (i % 6) {
      case 0:
        out.push(`a user named "user-${i}"`);
        break;
      case 1:
        out.push(`a product called "prod-${i}"`);
        break;
      case 2:
        out.push(`an order for ${i} items`);
        break;
      case 3:
        out.push(`the cart has ${i} items`);
        break;
      case 4:
        out.push(`the inventory shows ${i} units`);
        break;
      default:
        out.push(`I select "opt-${i}"`);
    }
  }
  return out;
}

function scan(cands: Compiled[], text: string): boolean {
  let hit = false;
  for (const c of cands) if (c.expression.match(text)) hit = true; // find-all (ambiguity-safe)
  return hit;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function time(label: string, fn: () => void): number {
  for (let i = 0; i < 2; i++) fn();
  const ts: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    ts.push(performance.now() - t0);
  }
  const med = median(ts);
  console.log(`${label.padEnd(26)}: ${med.toFixed(1)} ms (median of ${RUNS})`);
  return med;
}

function main(): void {
  register();
  const compiled = compileRegistry(globalRegistry).map(c => ({
    expression: c.expression,
    expr: c.step.expression,
  }));
  const texts = buildTexts();

  // Build the anchor index (given-only here).
  const byAnchor = new Map<string, Compiled[]>();
  const unanchored: Compiled[] = [];
  for (const c of compiled) {
    const a = anchorToken(c.expr);
    if (a === null) unanchored.push(c);
    else (byAnchor.get(a) ?? byAnchor.set(a, []).get(a)!).push(c);
  }
  const candidatesFor = (text: string): Compiled[] => {
    const anchored = byAnchor.get(firstToken(text));
    if (!anchored) return unanchored;
    return unanchored.length === 0 ? anchored : anchored.concat(unanchored);
  };

  const avgFull = compiled.length;
  const avgIndexed =
    texts.reduce((n, t) => n + candidatesFor(t).length, 0) / texts.length;

  const fullMs = time("FULL scan", () => {
    for (const t of texts) if (!scan(compiled, t)) throw new Error("miss");
  });
  const idxMs = time("INDEXED scan", () => {
    for (const t of texts)
      if (!scan(candidatesFor(t), t)) throw new Error("miss");
  });

  console.log("---------------------------");
  console.log(`defs                     : ${compiled.length}`);
  console.log(`unique texts             : ${texts.length}`);
  console.log(`avg candidates FULL      : ${avgFull.toFixed(1)}`);
  console.log(`avg candidates INDEXED   : ${avgIndexed.toFixed(1)}`);
  console.log(`speedup                  : ${(fullMs / idxMs).toFixed(2)}x`);
}

main();
