import { test, expect, afterEach } from "bun:test";
import { eventsReporter, RunEvent } from "./reporters";
import type { ScenarioResult } from "./engine";
import type { ParsedScenario, ParsedStep } from "../analyzer/types";

/**
 * Unit tests for the internal NDJSON `eventsReporter` — the parent↔child channel
 * behind `step-forge -i`. The TUI parses these events to render the results
 * region, so the contract worth pinning is: one event per scenario, a rendered
 * `detail` block only on failure, and a final `complete` with the duration.
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
function captureStdout(): { lines: () => RunEvent[]; restore: () => void } {
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
