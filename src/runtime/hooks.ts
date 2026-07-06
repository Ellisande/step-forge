/* eslint-disable @typescript-eslint/no-explicit-any */
import { MergeableWorld } from "../world";

/**
 * Hooks are side-effect callbacks that run around scenarios, feature files, or
 * the whole run. Unlike steps they never seed state: state is owned end to end
 * by the typed dependency graph (given/when/then), and hooks exist for setup and
 * teardown (opening a DB, starting a server, resetting mocks). A scenario hook
 * may *read* the world, but its return value is ignored.
 */
export type HookScope = "scenario" | "feature" | "global";
export type HookTiming = "before" | "after";

/** Lightweight scenario identity handed to per-scenario hooks. */
export interface ScenarioInfo {
  name: string;
  file: string;
}

/** A per-scenario hook: gets the scenario's world (read-only in spirit). */
export type ScenarioHookFn = (context: {
  world: MergeableWorld<any, any, any>;
  scenario: ScenarioInfo;
}) => void | Promise<void>;

/** A per-feature-file or global hook: no world exists at these boundaries. */
export type PlainHookFn = () => void | Promise<void>;

export interface RegisteredHook {
  scope: HookScope;
  timing: HookTiming;
  fn: ScenarioHookFn | PlainHookFn;
}

/**
 * Collection of registered hooks. Like {@link StepRegistry}, a plain instance
 * (not a hidden global) so tests can isolate; `globalHookRegistry` is the
 * default sink the public `beforeScenario`/`afterAll`/etc helpers write to.
 */
export class HookRegistry {
  private hooks: RegisteredHook[] = [];

  add(hook: RegisteredHook): void {
    this.hooks.push(hook);
  }

  /**
   * Hooks for a scope+timing. `before` hooks run in registration order;
   * `after` hooks run in reverse (LIFO), so teardown unwinds setup.
   */
  for(scope: HookScope, timing: HookTiming): RegisteredHook[] {
    const matching = this.hooks.filter(
      h => h.scope === scope && h.timing === timing
    );
    return timing === "after" ? matching.reverse() : matching;
  }

  clear(): void {
    this.hooks = [];
  }
}

export const globalHookRegistry = new HookRegistry();

/**
 * Run every registered hook of a scope+timing **in registration order** (after
 * hooks reversed by {@link HookRegistry.for}, so teardown unwinds setup). Used
 * for feature hooks, where ordering matters. Throws if a hook throws, so the
 * runner reports it against the enclosing boundary.
 */
export async function runHooks(
  scope: "feature" | "global",
  timing: HookTiming,
  registry: HookRegistry = globalHookRegistry
): Promise<void> {
  for (const hook of registry.for(scope, timing)) {
    await (hook.fn as PlainHookFn)();
  }
}

/**
 * Run every registered hook of a scope+timing **concurrently**, resolving once
 * all of them settle. This is how global `beforeAll`/`afterAll` run: independent
 * setup/teardown steps fire in parallel with no ordering between them. A hook
 * with a sequential requirement should sequence that work inside a single hook.
 *
 * The runner calls this exactly once for `beforeAll` (before any scenario
 * starts) and once for `afterAll` (after every scenario is done), so global
 * setup/teardown brackets the whole run deterministically. Rejects if any hook
 * rejects (via `Promise.all`), surfacing the first failure to the caller.
 */
export async function runHooksParallel(
  scope: "feature" | "global",
  timing: HookTiming,
  registry: HookRegistry = globalHookRegistry
): Promise<void> {
  await Promise.all(
    registry.for(scope, timing).map(hook => (hook.fn as PlainHookFn)())
  );
}
