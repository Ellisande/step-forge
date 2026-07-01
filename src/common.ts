/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Given as CucGiven,
  Then as CucThen,
  When as CucWhen,
} from "@cucumber/cucumber";
import _ from "lodash";

import { StepType } from "./builderTypeUtils";
import { Parser, stringParser } from "./parsers";
import { globalRegistry } from "./runtime/registry";
import { requireFromGiven, requireFromThen, requireFromWhen } from "./utils";
import { MergeableWorld } from "./world";

const cucFunctionMap = {
  given: CucGiven,
  when: CucWhen,
  then: CucThen,
};

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
      ...parsers.map(parser => parser.gherkin)
    );
    // The fully-wired step body, decoupled from any test runner: takes an
    // explicit world plus the raw values captured from a Gherkin step, applies
    // parsers + dependency narrowing, runs the user's step, and merges the
    // result. Both the Cucumber adapter and the native runtime call this.
    const execute = async (
      world: MergeableWorld<GivenState, WhenState, ThenState>,
      rawArgs: unknown[]
    ) => {
      // Iterate over parsers (not args) so any trailing arguments a runner
      // might pass don't get parsed as if they were captured variables.
      const coercedArgs = parsers.map((parser, index) =>
        parser.parse(rawArgs[index])
      );
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

    return {
      statement,
      expression,
      dependencies,
      stepType,
      stepFunction,
      register: () => {
        // Native runtime: make this step matchable/executable without Cucumber.
        globalRegistry.add({ stepType, expression, parsers, execute });

        // Cucumber adapter (still wired so the existing suite keeps passing).
        const cucStepFunction = Object.defineProperty(
          async function (
            this: MergeableWorld<GivenState, WhenState, ThenState>,
            ...args: string[]
          ) {
            await execute(this, args);
          },
          "length",
          { value: argCount, configurable: true }
        );
        // Cucumber throws if its functions are called while it isn't the
        // active runtime (e.g. under the native Vitest runner). Since the
        // registry above is the real source of truth, that's non-fatal here.
        try {
          const cucStep = cucFunctionMap[stepType];
          cucStep(expression, cucStepFunction);
        } catch {
          /* Cucumber not running — native runtime handles this step. */
        }
        return {
          stepType,
          expression,
          dependencies,
          statement: statementFunction,
          stepFunction,
        };
      },
    };
  };
