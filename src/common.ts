/* eslint-disable @typescript-eslint/no-explicit-any */
import { DepMap, FullDependencies, StepType } from "./builderTypeUtils";
import { Parser, stringParser } from "./parsers";
import { globalRegistry } from "./runtime/registry";
import { captureDefinitionSite } from "./sourceLocation";
import { MergeableWorld } from "./world";

/**
 * Read a step's declared dependencies for one phase out of the world, validating
 * that every `"required"` key is present. Mirrors the old `_.pick` + `requireFrom*`
 * pair, but the key lists are computed once at registration (see `addStep`), so
 * per-execution work is a couple of straight loops with no lodash or
 * `Object.entries`/`filter`/`map` churn. Phases with no declared dependencies
 * skip the world getter entirely (which would otherwise clone the whole phase
 * state) and return a fresh empty object.
 */
function narrowPhase(
  world: MergeableWorld<any, any, any>,
  phase: StepType,
  allKeys: string[],
  requiredKeys: string[]
): Record<string, unknown> {
  if (allKeys.length === 0) return {};
  const state = world[phase] as unknown as Record<string, unknown>;
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
 * The runtime core of the builder chain. `addStep` is deliberately phase-agnostic:
 * the calling builder (given/when/then) has already computed the exact type of the
 * step function via its two type parameters:
 *
 * - `StepFnInput`  — the `{ variables, given, when, then }` object the step receives,
 *   with each phase already narrowed to its declared dependencies.
 * - `StepFnOutput` — the phase-appropriate return type (`Partial<State>`, or `void`).
 *
 * Everything else is plain runtime data (a statement function, the step type, the
 * dependency map, the parsers), so `addStep` carries no generics for them.
 */
export const addStep =
  <StepFnInput, StepFnOutput>(
    statement: (...args: any[]) => string,
    stepType: StepType,
    dependencies: FullDependencies = {
      given: {},
      when: {},
      then: {},
    },
    declaredParsers?: Parser<any>[]
  ) =>
  (stepFunction: (input: StepFnInput) => StepFnOutput) => {
    const {
      given: givenDependencies,
      when: whenDependencies,
      then: thenDependencies,
    } = dependencies;
    // Resolve the parsers up front, defaulting every variable to `stringParser`
    // (the `{string}` placeholder, value passed through unchanged) when none are
    // provided. Numeric/boolean values are opt-in via explicit parsers.
    const argCount = statement.length;
    const parsers =
      declaredParsers ?? Array.from({ length: argCount }, () => stringParser);
    const expression = statement(...parsers.map(parser => `{${parser.name}}`));
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
        variables: capturedArgs,
        given: narrowPhase(world, "given", givenAllKeys, givenRequiredKeys),
        when: narrowPhase(world, "when", whenAllKeys, whenRequiredKeys),
        then: narrowPhase(world, "then", thenAllKeys, thenRequiredKeys),
      } as StepFnInput);
      world[stepType].merge({
        ...(result as any),
      });
    };

    // Registration is the terminal action of the builder chain: calling
    // `.step(fn)` makes the step matchable and executable by the runtime. We
    // capture *this* call site (the user's `.step(...)` line) so reporters can
    // show where a failing step is defined, Cucumber-style.
    const source = captureDefinitionSite();
    globalRegistry.add({ stepType, expression, parsers, execute, source });

    return {
      statement,
      expression,
      dependencies,
      stepType,
      stepFunction,
    };
  };
