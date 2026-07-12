import { test, expect, afterEach } from "bun:test";
import {
  eventsReporter,
  prettyReporter,
  quietReporter,
  RunEvent,
} from "./reporters";
import type { ScenarioResult } from "./engine";
import type { ParsedScenario, ParsedStep } from "../analyzer/types";

/**
 * Unit tests for the internal NDJSON `eventsReporter` — the parent↔child channel
 * behind `step-forge -i`. The TUI parses these events to render the results
 * region, so the contract worth pinning is: one event per scenario, a rendered
 * `detail` block only on failure (or on every scenario under `verbose`, which
 * the TUI requests for single-scenario runs), and a final `complete` with the
 * duration.
 */

function step(text: string): ParsedStep {
  return {
    keyword: "Given",
    effectiveKeyword: "Given",
    text,
    line: 3,
    column: 1,
  };
}

function scenario(name: string): ParsedScenario {
  return {
    name,
    file: "features/x.feature",
    line: 2,
    tags: [],
    steps: [step("a thing")],
  };
}

function passed(name: string): ScenarioResult {
  return {
    scenario: scenario(name),
    status: "passed",
    steps: [{ step: scenario(name).steps[0], status: "passed" }],
  };
}

function failed(name: string): ScenarioResult {
  const s = scenario(name);
  return {
    scenario: s,
    status: "failed",
    steps: [{ step: s.steps[0], status: "failed", error: new Error("boom") }],
    error: new Error("boom"),
  };
}

// Capture stdout for the duration of a test.
function captureStdout(): {
  lines: () => RunEvent[];
  raw: () => string;
  restore: () => void;
} {
  const original = process.stdout.write.bind(process.stdout);
  let buf = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((chunk: any) => {
    buf += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  return {
    lines: () =>
      buf
        .split("\n")
        .filter(l => l.trim())
        .map(l => JSON.parse(l) as RunEvent),
    raw: () => buf,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

let cap: ReturnType<typeof captureStdout> | undefined;
afterEach(() => cap?.restore());

test("emits one scenario event per scenario, then a complete event", () => {
  cap = captureStdout();
  const reporter = eventsReporter({ cwd: process.cwd() });
  reporter.onScenarioEnd!(passed("A"));
  reporter.onScenarioEnd!(passed("B"));
  reporter.onComplete([passed("A"), passed("B")], 1234);
  cap.restore();

  const events = cap.lines();
  expect(events).toHaveLength(3);
  expect(events[0]).toMatchObject({
    t: "scenario",
    status: "passed",
    name: "A",
  });
  expect(events[1]).toMatchObject({
    t: "scenario",
    status: "passed",
    name: "B",
  });
  expect(events[2]).toEqual({ t: "complete", durationMs: 1234 });
});

test("a passing scenario carries step counts and no detail", () => {
  cap = captureStdout();
  eventsReporter().onScenarioEnd!(passed("A"));
  cap.restore();

  const [event] = cap.lines();
  expect(event).toMatchObject({
    t: "scenario",
    status: "passed",
    steps: { passed: 1, failed: 0, skipped: 0 },
  });
  expect((event as { detail?: string }).detail).toBeUndefined();
});

test("verbose: a passing scenario carries the full step-by-step detail block", () => {
  cap = captureStdout();
  eventsReporter({ cwd: process.cwd(), verbose: true }).onScenarioEnd!(
    passed("A")
  );
  cap.restore();

  const [event] = cap.lines();
  expect(event).toMatchObject({ t: "scenario", status: "passed", name: "A" });
  const detail = (event as { detail?: string }).detail;
  expect(typeof detail).toBe("string");
  expect(detail).toContain("A"); // the scenario name heads the block
  expect(detail).toContain("a thing"); // each step is listed
});

test("a failing scenario carries a rendered detail block", () => {
  cap = captureStdout();
  eventsReporter({ cwd: process.cwd() }).onScenarioEnd!(failed("Broken"));
  cap.restore();

  const [event] = cap.lines();
  expect(event).toMatchObject({
    t: "scenario",
    status: "failed",
    name: "Broken",
  });
  const detail = (event as { detail?: string }).detail;
  expect(typeof detail).toBe("string");
  expect(detail).toContain("Broken"); // the scenario name is in the block
  expect(detail).toContain("boom"); // the error message is rendered
});

test("pretty heartbeat batches dots but flushes every one, in order", () => {
  // The buffered writer must not drop the tail: every scenario contributes one
  // heartbeat mark, regardless of how the writes were batched. (No TTY in tests,
  // so marks are uncoloured: "." pass / "F" fail.)
  cap = captureStdout();
  const reporter = prettyReporter({ cwd: process.cwd() });
  const results: ScenarioResult[] = [];
  for (let i = 0; i < 500; i++) {
    const r = i % 100 === 0 ? failed(`s${i}`) : passed(`s${i}`);
    results.push(r);
    reporter.onScenarioEnd!(r);
  }
  reporter.onComplete(results, 5);
  cap.restore();

  // The heartbeat has no newlines; the report body starts with one, so the first
  // line is the run of marks. Match the mark glyphs directly — any ANSI colour
  // codes contain none of ".", "F", "-" — so this holds with or without colour.
  const heartbeat = cap.raw().split("\n")[0];
  const marks = heartbeat.match(/[.F-]/g) ?? [];
  expect(marks.length).toBe(500); // nothing lost in the tail
  expect(marks.filter(m => m === "F").length).toBe(5); // the 5 failures
});

test("quiet reporter prints 'running', nothing per scenario, then failures + summary", () => {
  cap = captureStdout();
  const reporter = quietReporter({ cwd: process.cwd() }); // prints 'running…' now
  const results = [passed("A"), failed("Broken"), passed("C")];
  reporter.onComplete(results, 5);
  cap.restore();

  const out = cap.raw();
  // No per-scenario hook at all — the whole point is silence during the run.
  expect(reporter.onScenarioEnd).toBeUndefined();
  expect(out).toContain("running");
  // Failures are still rendered in Cucumber-style detail.
  expect(out).toContain("Broken");
  expect(out).toContain("boom");
  // ...and the end-of-run summary.
  expect(out).toContain("3 scenarios");
  expect(out).toContain("1 failed");
});

test("quiet reporter is silent on an all-pass run except 'running' + summary", () => {
  cap = captureStdout();
  quietReporter({ cwd: process.cwd() }).onComplete(
    [passed("A"), passed("B")],
    3
  );
  cap.restore();

  const out = cap.raw();
  expect(out).toContain("running");
  expect(out).toContain("2 scenarios");
  // No failure detail block (which would carry a `feature:` location line).
  expect(out).not.toContain("feature:");
});
