type Prettify<T> = {
  [K in keyof T]: T[K];
  // eslint-disable-next-line @typescript-eslint/ban-types -- `& {}` forces TS to eagerly expand the mapped type in tooltips
} & {};

/**
 * Narrows a state type to only the keys declared in a dependencies object.
 * Required dependencies stay required; optional dependencies become optional properties.
 * Keys in `Deps` that are not in `State` are omitted from the output.
 *
 * @example
 * type Given = { a: string; b: number; c: boolean };
 * type Deps = { a: "required"; b: "optional"; f: "optional" };
 * type Narrowed = StateFromDependencies<Given, Deps>;
 * // { a: string; b?: number }
 */
export type StateFromDependencies<
  State,
  Deps extends { [K in keyof Deps]: "required" | "optional" },
> = Prettify<
  {
    [
      K in keyof Deps as K extends keyof State
        ? Deps[K] extends "required"
          ? K
          : never
        : never
    ]: State[Extract<K, keyof State>];
  } & {
    [
      K in keyof Deps as K extends keyof State
        ? Deps[K] extends "optional"
          ? K
          : never
        : never
    ]?: State[Extract<K, keyof State>];
  }
>;
