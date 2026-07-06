import { test, expect } from "bun:test";
import { compileRegistry, runScenario } from "./engine";
import { StepRegistry } from "./registry";
import { HookRegistry, runHooksParallel, ScenarioInfo } from "./hooks";
import { BasicWorld } from "../world";
import type { ParsedScenario } from "../analyzer/types";

/**
 * Runtime-only tests for scenario-hook plumbing. These assert things about the
 * engine that used to be smoke-tested through a `.feature` step reading mutable
 * module state — a pattern that is a cross-scenario data race under concurrent
 * execution and violates the framework's "scenario state lives only in the
 * isolated world" contract. The correct home for "did the hook see the right
 * scenario?" is here, against the engine directly, not a Gherkin step.
 *
 * Internal-only: run with `bun test`, never shipped to consumers, so `bun:test`
 * (rather than a Node-portable harness) is fine.
 */

/** A minimal, step-free scenario — enough to exercise the hook lifecycle. */
function scenario(name: string, file: string): ParsedScenario {
  return { name, file, steps: [], tags: [] };
}

const noSteps = compileRegistry(new StepRegistry());
const makeWorld = () => new BasicWorld();

test("beforeScenario receives the running scenario's identity", async () => {
  const hooks = new HookRegistry();
  const seen: ScenarioInfo[] = [];
  hooks.add({
    scope: "scenario",
    timing: "before",
    fn: ({ scenario: info }) => {
      seen.push(info);
    },
  });

  await runScenario(
    scenario("Login works", "auth.feature"),
    noSteps,
    makeWorld,
    hooks
  );

  expect(seen).toEqual([{ name: "Login works", file: "auth.feature" }]);
});

test("scenario hooks run before and after, in order", async () => {
  const hooks = new HookRegistry();
  const order: string[] = [];
  hooks.add({
    scope: "scenario",
    timing: "before",
    fn: () => void order.push("before"),
  });
  hooks.add({
    scope: "scenario",
    timing: "after",
    fn: () => void order.push("after"),
  });

  await runScenario(scenario("s", "f.feature"), noSteps, makeWorld, hooks);

  expect(order).toEqual(["before", "after"]);
});

test("each scenario's before-hook sees only its own identity (no cross-talk)", async () => {
  // The property that made the old module-global assertion racy: two scenarios
  // running against the same hook registry must each observe their own name,
  // even when interleaved. Run them concurrently to prove it.
  const hooks = new HookRegistry();
  const seenByRun = new Map<string, string[]>();
  hooks.add({
    scope: "scenario",
    timing: "before",
    fn: ({ scenario: info }) => {
      const bucket = seenByRun.get(info.file) ?? [];
      bucket.push(info.name);
      seenByRun.set(info.file, bucket);
    },
  });

  await Promise.all([
    runScenario(scenario("A", "a.feature"), noSteps, makeWorld, hooks),
    runScenario(scenario("B", "b.feature"), noSteps, makeWorld, hooks),
  ]);

  expect(seenByRun.get("a.feature")).toEqual(["A"]);
  expect(seenByRun.get("b.feature")).toEqual(["B"]);
});

test("runHooksParallel runs global hooks concurrently, not in registration order", async () => {
  const reg = new HookRegistry();
  const order: string[] = [];
  let releaseB!: () => void;
  const bStarted = new Promise<void>(resolve => (releaseB = resolve));

  // Hook A is registered first but can only finish once B has started. If the
  // hooks ran sequentially in registration order, A would await `bStarted`
  // forever (B never gets a turn) and this test would hang — so it passing at
  // all proves they run concurrently, and the order proves B finished first.
  reg.add({
    scope: "global",
    timing: "before",
    fn: async () => {
      await bStarted;
      order.push("A");
    },
  });
  reg.add({
    scope: "global",
    timing: "before",
    fn: async () => {
      order.push("B");
      releaseB();
    },
  });

  await runHooksParallel("global", "before", reg);

  expect(order).toEqual(["B", "A"]);
});

test("runHooksParallel awaits every hook before resolving", async () => {
  const reg = new HookRegistry();
  const done: string[] = [];
  reg.add({
    scope: "global",
    timing: "after",
    fn: async () => {
      await Promise.resolve();
      done.push("x");
    },
  });
  reg.add({ scope: "global", timing: "after", fn: () => void done.push("y") });

  await runHooksParallel("global", "after", reg);

  expect(done.sort()).toEqual(["x", "y"]);
});

test("runHooksParallel rejects if any hook throws", async () => {
  const reg = new HookRegistry();
  reg.add({
    scope: "global",
    timing: "before",
    fn: async () => {
      throw new Error("boom");
    },
  });

  await expect(runHooksParallel("global", "before", reg)).rejects.toThrow(
    "boom"
  );
});
