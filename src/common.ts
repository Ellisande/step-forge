/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Given as CucGiven,
  Then as CucThen,
  When as CucWhen,
} from "@cucumber/cucumber";
import _ from "lodash";

import { StepType } from "./builderTypeUtils";
import { Parser, stringParser } from "./parsers";
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
    return {
      statement,
      expression,
      dependencies,
      stepType,
      stepFunction,
      register: () => {
        const cucStepFunction = Object.defineProperty(
          async function (
            this: MergeableWorld<GivenState, WhenState, ThenState>,
            ...args: string[]
          ) {
            // Iterate over parsers (not args) so Cucumber's trailing
            // arguments don't get parsed as if they were captured variables.
            const coercedArgs = parsers.map((parser, index) =>
              parser.parse(args[index])
            );
            const requiredGivenKeys = Object.entries(givenDependencies ?? {})
              .filter(([, value]) => value === "required")
              .map(([key]) => key);
            const ensuredGivenValues = requireFromGiven(
              requiredGivenKeys as (keyof GivenState)[],
              this
            );
            const narrowedGiven = {
              ..._.pick(this.given, Object.keys(givenDependencies ?? {})),
              ...ensuredGivenValues,
            };
            const requiredWhenKeys = Object.entries(whenDependencies ?? {})
              .filter(([, value]) => value === "required")
              .map(([key]) => key);
            const ensuredWhenValues = requireFromWhen(
              requiredWhenKeys as (keyof WhenState)[],
              this
            );
            const narrowedWhen = {
              ..._.pick(this.when, Object.keys(whenDependencies ?? {})),
              ...ensuredWhenValues,
            };
            const requiredThenKeys = Object.entries(thenDependencies ?? {})
              .filter(([, value]) => value === "required")
              .map(([key]) => key);
            const ensuredThenValues = requireFromThen(
              requiredThenKeys as (keyof ThenState)[],
              this
            );
            const narrowedThen = {
              ..._.pick(this.then, Object.keys(thenDependencies ?? {})),
              ...ensuredThenValues,
            };
            const result = await stepFunction({
              variables: coercedArgs as Variables,
              given: narrowedGiven as RestrictedGivenState,
              when: narrowedWhen as RestrictedWhenState,
              then: narrowedThen as RestrictedThenState,
            });
            this[stepType].merge({
              ...(result as any),
            });
          },
          "length",
          { value: argCount, configurable: true }
        );
        const cucStep = cucFunctionMap[stepType];
        cucStep(expression, cucStepFunction);
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
