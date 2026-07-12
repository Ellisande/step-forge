/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Measures output *write* cost — the reporter's live heartbeat currently does
 * one `process.stdout.write` per scenario (a single "." / "F" / "-"). This A/Bs
 * that against buffered strategies to see how much per-write overhead there is.
 *
 * Run piped so we measure the write path, not a terminal emulator's drawing:
 *   bun bench/output-cost.ts > /dev/null
 *   bun bench/output-cost.ts | cat            (pipe, isTTY=false)
 * Results print to stderr so they survive the redirect.
 */
const N = Number(process.env.SF_N ?? 200000);
const RUNS = Number(process.env.SF_RUNS ?? 5);
const DOT = "\x1b[32m.\x1b[39m"; // a coloured dot, like scenarioDot()

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
  process.stderr.write(`${label.padEnd(38)}: ${med.toFixed(1)} ms\n`);
  return med;
}

// A. Current: one write per scenario.
const perScenario = () => {
  for (let i = 0; i < N; i++) process.stdout.write(DOT);
};

// B. Buffer into a string, flush every FLUSH scenarios.
const buffered = (flush: number) => () => {
  let buf = "";
  let n = 0;
  for (let i = 0; i < N; i++) {
    buf += DOT;
    if (++n >= flush) {
      process.stdout.write(buf);
      buf = "";
      n = 0;
    }
  }
  if (buf) process.stdout.write(buf);
};

// C. Push into an array, join once, single write (upper bound).
const singleWrite = () => {
  const parts: string[] = new Array(N);
  for (let i = 0; i < N; i++) parts[i] = DOT;
  process.stdout.write(parts.join(""));
};

function main(): void {
  process.stderr.write(
    `output write bench — ${N} dots, stdout.isTTY=${process.stdout.isTTY ?? false}\n`
  );
  time("A. per-scenario write", perScenario);
  time("B. buffered, flush=64", buffered(64));
  time("B. buffered, flush=256", buffered(256));
  time("C. single join+write", singleWrite);
}

main();
