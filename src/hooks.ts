/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  globalHookRegistry,
  PlainHookFn,
  ScenarioHookFn,
  ScenarioInfo,
} from "./runtime/hooks";
import { MergeableWorld } from "./world";

/**
 * Run before every scenario, with access to that scenario's fresh world. For
 * side effects only (reset a mock, seed an external system) — return values are
 * ignored; seed test *state* with given steps so the dependency graph stays the
 * single source of truth.
 */
export function beforeScenario<
  World extends MergeableWorld<any, any, any> = MergeableWorld<any, any, any>,
>(
  fn: (context: {
    world: World;
    scenario: ScenarioInfo;
  }) => void | Promise<void>
): void {
  globalHookRegistry.add({
    scope: "scenario",
    timing: "before",
    fn: fn as ScenarioHookFn,
  });
}

/**
 * Run after every scenario (even when a step failed), with access to that
 * scenario's world. Runs in reverse registration order so teardown unwinds
 * setup. For cleanup side effects only.
 */
export function afterScenario<
  World extends MergeableWorld<any, any, any> = MergeableWorld<any, any, any>,
>(
  fn: (context: {
    world: World;
    scenario: ScenarioInfo;
  }) => void | Promise<void>
): void {
  globalHookRegistry.add({
    scope: "scenario",
    timing: "after",
    fn: fn as ScenarioHookFn,
  });
}

/** Run once at the start of each feature file. No world exists at this boundary. */
export function beforeFeature(fn: PlainHookFn): void {
  globalHookRegistry.add({ scope: "feature", timing: "before", fn });
}

/** Run once at the end of each feature file (reverse registration order). */
export function afterFeature(fn: PlainHookFn): void {
  globalHookRegistry.add({ scope: "feature", timing: "after", fn });
}

/**
 * Run once before the entire run, ahead of any scenario (and before
 * concurrency starts). Multiple `beforeAll` hooks run **in parallel** with no
 * ordering between them — if a step of setup must precede another, sequence both
 * inside a single hook.
 */
export function beforeAll(fn: PlainHookFn): void {
  globalHookRegistry.add({ scope: "global", timing: "before", fn });
}

/**
 * Run once after the entire run, once every scenario is done. Multiple
 * `afterAll` hooks run **in parallel** with no ordering between them — sequence
 * dependent teardown inside a single hook.
 */
export function afterAll(fn: PlainHookFn): void {
  globalHookRegistry.add({ scope: "global", timing: "after", fn });
}
