/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from "lodash";

import { DepMap, FullDependencies, StepType } from "./builderTypeUtils";
import { Parser, stringParser } from "./parsers";
import { globalRegistry } from "./runtime/registry";
import { requireFromGiven, requireFromThen, requireFromWhen } from "./utils";
import { MergeableWorld } from "./world";

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
      const requiredKeys = (deps: DepMap) =>
        Object.entries(deps)
          .filter(([, value]) => value === "required")
          .map(([key]) => key);
      const narrowedGiven = {
        ..._.pick(world.given, Object.keys(givenDependencies)),
        ...requireFromGiven(requiredKeys(givenDependencies), world),
      };
      const narrowedWhen = {
        ..._.pick(world.when, Object.keys(whenDependencies)),
        ...requireFromWhen(requiredKeys(whenDependencies), world),
      };
      const narrowedThen = {
        ..._.pick(world.then, Object.keys(thenDependencies)),
        ...requireFromThen(requiredKeys(thenDependencies), world),
      };
      const result = await stepFunction({
        variables: capturedArgs,
        given: narrowedGiven,
        when: narrowedWhen,
        then: narrowedThen,
      } as StepFnInput);
      world[stepType].merge({
        ...(result as any),
      });
    };

    // Registration is the terminal action of the builder chain: calling
    // `.step(fn)` makes the step matchable and executable by the runtime.
    globalRegistry.add({ stepType, expression, parsers, execute });

    return {
      statement,
      expression,
      dependencies,
      stepType,
      stepFunction,
    };
  };
