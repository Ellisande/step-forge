/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from "lodash";

import { StepType } from "./builderTypeUtils";
import { Parser, stringParser } from "./parsers";
import { globalRegistry } from "./runtime/registry";
import { requireFromGiven, requireFromThen, requireFromWhen } from "./utils";
import { MergeableWorld } from "./world";

export const addStep =
  <
    ResolvedStepType extends StepType,
    Statement extends (...args: any[]) => string,
    Dependencies extends {
      given: any;
      when: any;
      then: any;
    },
    Variables,
    GivenState,
    WhenState,
    ThenState,
    RestrictedGivenState,
    RestrictedWhenState,
    RestrictedThenState,
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    dependencies: Dependencies = {
      given: {},
      when: {},
      then: {},
    } as Dependencies,
    declaredParsers?: Parser<any>[]
  ) =>
  (
    stepFunction: (input: {
      variables: Variables;
      given: RestrictedGivenState;
      when: RestrictedWhenState;
      then: RestrictedThenState;
    }) => ResolvedStepType extends "given"
      ? Partial<GivenState> | Promise<Partial<GivenState>>
      : ResolvedStepType extends "when"
        ? Partial<WhenState> | Promise<Partial<WhenState>>
        :
            | Partial<ThenState>
            | Promise<Partial<ThenState>>
            | void
            | Promise<void>
  ) => {
    const statementFunction = statement;
    const {
      given: givenDependencies,
      when: whenDependencies,
      then: thenDependencies,
    } = dependencies;
    // Resolve the parsers up front, defaulting every variable to `stringParser`
    // (the `{string}` placeholder, value passed through unchanged) when none are
    // provided. Numeric/boolean values are opt-in via explicit parsers.
    const argCount = statementFunction.length;
    const parsers =
      declaredParsers ?? Array.from({ length: argCount }, () => stringParser);
    const expression = statementFunction(
      ...parsers.map(parser => `{${parser.name}}`)
    );
    // The fully-wired step body, decoupled from any test runner: takes an
    // explicit world plus the values captured from a Gherkin step, validates +
    // narrows dependencies, runs the user's step, and merges the result. The
    // captured values arrive already coerced — each parser is registered as the
    // cucumber-expression parameter type, so `parse` runs during matching, not
    // here.
    const execute = async (
      world: MergeableWorld<GivenState, WhenState, ThenState>,
      capturedArgs: unknown[]
    ) => {
      const coercedArgs = capturedArgs;
      const requiredGivenKeys = Object.entries(givenDependencies ?? {})
        .filter(([, value]) => value === "required")
        .map(([key]) => key);
      const ensuredGivenValues = requireFromGiven(
        requiredGivenKeys as (keyof GivenState)[],
        world
      );
      const narrowedGiven = {
        ..._.pick(world.given, Object.keys(givenDependencies ?? {})),
        ...ensuredGivenValues,
      };
      const requiredWhenKeys = Object.entries(whenDependencies ?? {})
        .filter(([, value]) => value === "required")
        .map(([key]) => key);
      const ensuredWhenValues = requireFromWhen(
        requiredWhenKeys as (keyof WhenState)[],
        world
      );
      const narrowedWhen = {
        ..._.pick(world.when, Object.keys(whenDependencies ?? {})),
        ...ensuredWhenValues,
      };
      const requiredThenKeys = Object.entries(thenDependencies ?? {})
        .filter(([, value]) => value === "required")
        .map(([key]) => key);
      const ensuredThenValues = requireFromThen(
        requiredThenKeys as (keyof ThenState)[],
        world
      );
      const narrowedThen = {
        ..._.pick(world.then, Object.keys(thenDependencies ?? {})),
        ...ensuredThenValues,
      };
      const result = await stepFunction({
        variables: coercedArgs as Variables,
        given: narrowedGiven as RestrictedGivenState,
        when: narrowedWhen as RestrictedWhenState,
        then: narrowedThen as RestrictedThenState,
      });
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
