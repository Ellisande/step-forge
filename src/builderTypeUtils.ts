/* eslint-disable @typescript-eslint/no-explicit-any */
export type StepType = "given" | "when" | "then";

/** A dependency declaration: each key of a phase's state marked required/optional. */
export type RequiredOrOptional<T> = {
  [K in keyof T]?: "required" | "optional";
};

/** The dependency map for a single phase, keyed by state property name. */
export type DepMap = Record<string, "required" | "optional">;

/** The fully-resolved dependency declaration passed to `addStep` at runtime. */
export type FullDependencies = {
  given: DepMap;
  when: DepMap;
  then: DepMap;
};

/**
 * Narrows a phase's full state to only the keys named in a dependency map.
 * Optional dependencies widen to `| undefined`; keys not present in the state
 * are dropped. This is the shape a step function sees for `given`/`when`/`then`.
 */
export type Restrict<State, Deps extends RequiredOrOptional<State>> = {
  [
    K in keyof State as K extends keyof Deps ? K : never
  ]: Deps[K] extends "optional" ? State[K] | undefined : State[K];
};

export type GetFunctionArgs<T> = T extends (...args: infer A) => any
  ? A
  : never;

export const isString = (
  statement: string | ((...args: [...any]) => string)
): statement is string => typeof statement === "string";
