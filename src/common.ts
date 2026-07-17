/* eslint-disable @typescript-eslint/no-explicit-any */
import { DepMap, FullDependencies, StepType } from "./builderTypeUtils";
import { Parser } from "./parsers";
import { globalRegistry } from "./runtime/registry";
import { captureDefinitionSite } from "./sourceLocation";
import { renderNamedExpression, VariableMap } from "./variables";
import { MergeableWorld } from "./world";

/**
 * Read a step's declared dependencies for one phase out of the world, validating
 * that every `"required"` key is present. Mirrors the old `_.pick` + `requireFrom*`
 * pair, but the key lists are computed once at registration (see `addStep`), so
 * per-execution work is a couple of straight loops with no lodash or
 * `Object.entries`/`filter`/`map` churn. Phases with no declared dependencies
 * skip the state read entirely and return a fresh empty object.
 *
 * The `out` object handed to the step is always freshly built here, so mutating
 * it can never reach world state — the only mutation path is a step's return
 * value flowing through `merge`/`mergeInto`. That guarantee is why we can read
 * from the world's *live* state (`readState`, no clone) instead of the cloning
 * getter: the live object never escapes this function. Custom worlds without
 * the fast-path fall back to the `given`/`when`/`then` getter.
 */
function narrowPhase(
  world: MergeableWorld<any, any, any>,
  phase: StepType,
  allKeys: string[],
  requiredKeys: string[]
): Record<string, unknown> {
  if (allKeys.length === 0) return {};
  const state = world.readState
    ? world.readState(phase)
    : (world[phase] as unknown as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const key of allKeys) {
    if (key in state) out[key] = state[key];
  }
  for (const key of requiredKeys) {
    if (!out[key]) {
      throw new Error(`Key ${key} is required in ${phase} state`);
    }
  }
  return out;
}

/** The `"required"` keys of a dependency map. */
const requiredKeysOf = (deps: DepMap): string[] =>
  Object.keys(deps).filter(key => deps[key] === "required");

/**
 * Everything the registration core needs beyond the step function itself.
 * Built by `addStep`; `registerStep` is the shared registration tail.
 */
type StepRuntimeConfig = {
  statement: (...args: any[]) => string;
  /** The finished cucumber expression, placeholders already rendered. */
  expression: string;
  /** Parsers in capture-group order — exactly what the engine registers. */
  parsers: Parser<any>[];
  /**
   * Shape the matcher's positional captures into the name-keyed `variables`
   * object the step function sees.
   */
  toVariables: (capturedArgs: unknown[]) => unknown;
  stepType: StepType;
  dependencies: FullDependencies;
};

/**
 * The runtime core of the builder chain, phase-agnostic: the calling builder
 * has already computed the exact type of the step function via the type
 * parameters:
 *
 * - `StepFnInput`  — the `{ variables, given, when, then }` object the step receives,
 *   with each phase already narrowed to its declared dependencies.
 * - `StepFnOutput` — the phase-appropriate return type (`Partial<State>`, or `void`).
 * - `Expr`         — the statement's compile-time text: the exact literal for a
 *   string statement, a `${string}`-holed template type for a token statement.
 *   The returned metadata's `expression` carries it.
 *
 * Everything else is plain runtime data carried in the config, so `registerStep`
 * carries no generics for it.
 */
const registerStep =
  <StepFnInput, StepFnOutput, Expr extends string>(config: StepRuntimeConfig) =>
  (stepFunction: (input: StepFnInput) => StepFnOutput) => {
    const {
      statement,
      expression,
      parsers,
      toVariables,
      stepType,
      dependencies,
    } = config;
    const {
      given: givenDependencies,
      when: whenDependencies,
      then: thenDependencies,
    } = dependencies;
    // Dependency key lists are fixed once the step is registered, so compute
    // them here (once) rather than on every execution. `*AllKeys` is every
    // declared dependency (required + optional), `*RequiredKeys` the subset that
    // must be present at run time.
    const givenAllKeys = Object.keys(givenDependencies);
    const whenAllKeys = Object.keys(whenDependencies);
    const thenAllKeys = Object.keys(thenDependencies);
    const givenRequiredKeys = requiredKeysOf(givenDependencies);
    const whenRequiredKeys = requiredKeysOf(whenDependencies);
    const thenRequiredKeys = requiredKeysOf(thenDependencies);
    // The fully-wired step body, decoupled from any test runner: takes an
    // explicit world plus the values captured from a Gherkin step, validates +
    // narrows dependencies, runs the user's step, and merges the result. The
    // captured values arrive already coerced — each parser is registered as the
    // cucumber-expression parameter type, so `parse` runs during matching, not
    // here.
    const execute = async (
      world: MergeableWorld<any, any, any>,
      capturedArgs: unknown[]
    ) => {
      const result = await stepFunction({
        variables: toVariables(capturedArgs),
        given: narrowPhase(world, "given", givenAllKeys, givenRequiredKeys),
        when: narrowPhase(world, "when", whenAllKeys, whenRequiredKeys),
        then: narrowPhase(world, "then", thenAllKeys, thenRequiredKeys),
      } as StepFnInput);
      const produced = { ...(result as any) };
      // Fast-path merge when the world exposes it (BasicWorld); otherwise go
      // through the getter's `merge` so custom worlds still work.
      if (world.mergeInto) world.mergeInto(stepType, produced);
      else world[stepType].merge(produced);
    };

    // Registration is the terminal action of the builder chain: calling
    // `.step(fn)` makes the step matchable and executable by the runtime. We
    // capture *this* call site (the user's `.step(...)` line) so reporters can
    // show where a failing step is defined, Cucumber-style.
    const source = captureDefinitionSite();
    globalRegistry.add({ stepType, expression, parsers, execute, source });

    return {
      statement,
      expression: expression as Expr,
      dependencies,
      stepType,
      stepFunction,
    };
  };

/**
 * Registration for the builder chain: the `.variables()` map declares
 * name → parser, the statement interpolates opaque tokens (a string statement
 * is normalized by the builder to `() => statement` with an empty map), and
 * the step function receives `variables` as a name-keyed object. The token
 * dance in `renderNamedExpression` recovers the interpolation order, which is
 * the bridge between the matcher's positional captures and the named object.
 */
export const addStep = <StepFnInput, StepFnOutput, Expr extends string>(
  statement: (tokens: any) => string,
  stepType: StepType,
  dependencies: FullDependencies = {
    given: {},
    when: {},
    then: {},
  },
  variables: VariableMap = {}
) => {
  const { expression, order } = renderNamedExpression(statement, variables);
  return registerStep<StepFnInput, StepFnOutput, Expr>({
    statement,
    expression,
    parsers: order.map(name => variables[name]),
    toVariables: capturedArgs => {
      const named: Record<string, unknown> = {};
      for (let i = 0; i < order.length; i++) {
        named[order[i]] = capturedArgs[i];
      }
      return named;
    },
    stepType,
    dependencies,
  });
};
