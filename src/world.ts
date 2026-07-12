import _ from "lodash";

export type WorldState<State> = {
  readonly [K in keyof State]?: State[K];
};

export type MergeableWorldState<T> = WorldState<T> & {
  merge: (newState: Partial<T>) => void;
};

/**
 * Customizer for `_.mergeWith` (NOT `_.merge` — that has no customizer slot and
 * would treat this function as an inert extra source, the bug this replaced).
 *
 * - Arrays: produce a **new** array of old-then-new elements (`concat`), never a
 *   per-index merge. Adding `[2]` to `[1]` yields `[1, 2]`, and the previous
 *   array object is left untouched (so earlier snapshots keep their value).
 * - A truthy non-plain-object (a scalar, Date, class instance, …) being replaced
 *   by a different value throws, rather than silently clobbering state.
 * - Everything else (a new key, or two plain objects) returns `undefined` so
 *   lodash applies its default: assign / recurse. Returning `objValue` here
 *   would halt recursion and drop nested updates.
 */
function mergeCustomizer(objValue: unknown, srcValue: unknown) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue);
  } else if (objValue && !_.isPlainObject(objValue) && objValue !== srcValue) {
    throw new Error(
      `Merge would have destroyed previous value ${objValue} with ${srcValue}`
    );
  }
  return undefined;
}

export const createMergeableState = <T>(
  state: WorldState<T>
): MergeableWorldState<T> => {
  return {
    ...state,
    merge: (newState: Partial<T>) => {
      state = _.mergeWith({ ...state }, newState, mergeCustomizer);
    },
  };
};

type Phase = "given" | "when" | "then";

export type MergeableWorld<Given, When, Then> = {
  given: MergeableWorldState<Given>;
  when: MergeableWorldState<When>;
  then: MergeableWorldState<Then>;
  /**
   * Internal engine fast-path (optional). `BasicWorld` implements these so the
   * runtime can read a step's declared dependencies and apply its result
   * *without* cloning the whole phase state on every step — the cost the public
   * `given`/`when`/`then` getters pay to hand out an isolated snapshot. A custom
   * world factory may omit them; the engine then falls back to the getters +
   * `merge` above. They are not part of the user-facing world API.
   */
  readState?: (phase: Phase) => Readonly<Record<string, unknown>>;
  mergeInto?: (phase: Phase, newState: Record<string, unknown>) => void;
};

export class BasicWorld<Given, When, Then> {
  private givenState: WorldState<Given> = {};
  private whenState: WorldState<When> = {};
  private thenState: WorldState<Then> = {};

  /** The live state object for a phase (no copy). */
  private raw(phase: Phase): Record<string, unknown> {
    const state =
      phase === "given"
        ? this.givenState
        : phase === "when"
          ? this.whenState
          : this.thenState;
    return state as Record<string, unknown>;
  }

  /**
   * Internal engine read: the *live* phase state, returned by reference and
   * without a clone. The engine reads only the keys a step declared as
   * dependencies and copies them into a fresh object it hands to the step, so
   * the live object never reaches user code — the "mutating a read value can't
   * change world state" guarantee is preserved by that fresh copy, exactly as
   * the getters preserve it for hooks. Typed `Readonly` because callers must not
   * mutate it. Not part of the user-facing world API.
   */
  public readState(phase: Phase): Readonly<Record<string, unknown>> {
    return this.raw(phase);
  }

  /**
   * Internal engine write: apply a step's returned partial state. This is the
   * one and only mutation path — a deep merge (arrays concatenate) identical to
   * the getters' `merge`, but it skips the whole-state clone the getter would
   * do just to expose `merge`. State is never mutated in place: a new object
   * replaces the field, so any snapshot handed out earlier stays untouched.
   */
  public mergeInto(phase: Phase, newState: Record<string, unknown>): void {
    const merged = _.mergeWith(
      { ...this.raw(phase) },
      newState,
      mergeCustomizer
    );
    if (phase === "given") this.givenState = merged as WorldState<Given>;
    else if (phase === "when") this.whenState = merged as WorldState<When>;
    else this.thenState = merged as WorldState<Then>;
  }

  public get given(): MergeableWorldState<Given> {
    return {
      ...this.givenState,
      merge: (newState: Partial<Given>) =>
        this.mergeInto("given", newState as Record<string, unknown>),
    };
  }

  public get when(): MergeableWorldState<When> {
    return {
      ...this.whenState,
      merge: (newState: Partial<When>) =>
        this.mergeInto("when", newState as Record<string, unknown>),
    };
  }

  public get then(): MergeableWorldState<Then> {
    return {
      ...this.thenState,
      merge: (newState: Partial<Then>) =>
        this.mergeInto("then", newState as Record<string, unknown>),
    };
  }
}

export const createBasicWorld = <Given, When, Then>(): MergeableWorld<
  Given,
  When,
  Then
> => {
  return new BasicWorld<Given, When, Then>();
};
