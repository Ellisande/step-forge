/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Isolates the per-step write cost — what `BasicWorld.mergeInto` does on every
 * step: `{ ...raw }` shallow clone of the whole phase state + `_.mergeWith`.
 *
 * Two axes:
 *   - WIDTH: how many keys the phase state already holds (does the O(keys) clone
 *     dominate?).
 *   - lodash overhead: current `_.mergeWith` vs a hand-rolled shallow
 *     clone+assign that reproduces the common shallow case, to see the ceiling.
 *
 * Run: bun bench/merge-cost.ts
 */
import _ from "lodash";

const MERGES = Number(process.env.SF_MERGES ?? 300000);
const RUNS = Number(process.env.SF_RUNS ?? 7);

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
  console.log(
    `${label.padEnd(34)}: ${med.toFixed(1)} ms  (${Math.round(
      MERGES / (med / 1000)
    ).toLocaleString()} merges/s)`
  );
  return med;
}

function mergeCustomizer(objValue: unknown, srcValue: unknown) {
  if (_.isArray(objValue)) return objValue.concat(srcValue);
  else if (objValue && !_.isPlainObject(objValue) && objValue !== srcValue)
    throw new Error("destroyed");
  return undefined;
}

// A phase state pre-seeded with `width` keys, mutated `MERGES` times with a tiny
// one-key update. `apply` is the merge implementation under test.
function drive(
  width: number,
  apply: (
    state: Record<string, any>,
    patch: Record<string, any>
  ) => Record<string, any>
): void {
  let state: Record<string, any> = {};
  for (let k = 0; k < width; k++) state[`k${k}`] = k;
  // Re-set one key to a *constant* each merge: exercises the clone + merge on a
  // fixed-width state without tripping the destructive-overwrite guard.
  for (let i = 0; i < MERGES; i++) {
    state = apply(state, { tick: 1 });
  }
  if (state.tick !== 1) throw new Error("bad");
}

const currentImpl = (s: Record<string, any>, p: Record<string, any>) =>
  _.mergeWith({ ...s }, p, mergeCustomizer);

// Hand-rolled shallow clone+assign — the common case (no arrays / nested objects
// / scalar conflicts). Same O(keys) clone, but no lodash machinery.
const shallowImpl = (s: Record<string, any>, p: Record<string, any>) => {
  const out: Record<string, any> = { ...s };
  for (const key in p) out[key] = p[key];
  return out;
};

function main(): void {
  for (const width of [3, 30, 150]) {
    console.log(`--- state width ${width} keys, ${MERGES} merges ---`);
    time(`current  (_.mergeWith + {...s})`, () => drive(width, currentImpl));
    time(`shallow  ({...s} + assign)`, () => drive(width, shallowImpl));
  }
}

main();
