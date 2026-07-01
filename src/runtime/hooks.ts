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
 * Run every registered feature/global hook of a scope+timing in order. Used by
 * the generated test modules (feature hooks). Throws if a hook throws, so the
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

// Process-global (via Symbol.for so it survives module duplication) guard so
// global hooks fire exactly once per worker, no matter how many feature modules
// call in.
const GLOBAL_GUARD = Symbol.for("step-forge.globalHooksStarted");

/**
 * Run global before-hooks once per worker, ahead of that worker's first
 * scenario, and schedule global after-hooks for worker exit. Idempotent: every
 * feature module calls this in a `beforeAll`, but only the first call in a given
 * worker does anything.
 *
 * Semantics & caveats (the once-per-worker model):
 * - Runs in the *same* realm as steps, so global setup may touch in-process
 *   state that steps later read.
 * - "Once per worker", not strictly once per run — with multiple workers it runs
 *   in each. Size global setup to be worker-safe (e.g. a server per worker).
 * - Teardown is best-effort: after-hooks start on the worker's `beforeExit` and
 *   are not awaited by the runner, so keep them fast/synchronous.
 */
export async function ensureGlobalHooks(
  registry: HookRegistry = globalHookRegistry
): Promise<void> {
  const store = globalThis as Record<symbol, boolean>;
  if (store[GLOBAL_GUARD]) return;
  store[GLOBAL_GUARD] = true;

  for (const hook of registry.for("global", "before")) {
    await (hook.fn as PlainHookFn)();
  }

  process.once("beforeExit", () => {
    void (async () => {
      for (const hook of registry.for("global", "after")) {
        await (hook.fn as PlainHookFn)();
      }
    })();
  });
}
