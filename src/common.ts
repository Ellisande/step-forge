/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Given as CucGiven,
  Then as CucThen,
  When as CucWhen,
} from "@cucumber/cucumber";
import { pick } from "lodash";

import { StepType } from "./builderTypeUtils";
import {
  requireFromGiven,
  requireFromThen,
  requireFromWhen,
  typeCoercer,
} from "./utils";
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
    } as Dependencies
  ) =>
  (
    stepFunction: (input: {
      variables: Variables;
      given: RestrictedGivenState;
      when: RestrictedWhenState;
      then: RestrictedThenState;
    }) => ResolvedStepType extends "given"
      ? Partial<GivenState>
      : ResolvedStepType extends "when"
        ? Partial<WhenState>
        : Partial<ThenState>
  ) => {
    const statementFunction = statement;
    const {
      given: givenDependencies,
      when: whenDependencies,
      then: thenDependencies,
    } = dependencies;
    return {
      statement,
      dependencies,
      stepType,
      stepFunction,
      register: () => {
        const argCount = statementFunction.length;
        const argMatchers = Array.from({ length: argCount }, () => "{string}");
        const statement = statementFunction(...argMatchers);
        console.error("The statement is", statement);
        const cucStepFunction = Object.defineProperty(
          async function (
            this: MergeableWorld<GivenState, WhenState, ThenState>,
            ...args: string[]
          ) {
            const coercedArgs = args.map(typeCoercer);
            const requiredGivenKeys = Object.entries(givenDependencies ?? {})
              .filter(([, value]) => value === "required")
              .map(([key]) => key);
            const ensuredGivenValues = requireFromGiven(
              requiredGivenKeys as (keyof GivenState)[],
              this
            );
            const narrowedGiven = {
              ...pick(this.given, Object.keys(givenDependencies ?? {})),
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
              ...pick(this.when, Object.keys(whenDependencies ?? {})),
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
              ...pick(this.then, Object.keys(thenDependencies ?? {})),
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
        cucStep(statement, cucStepFunction);
        return {
          stepType,
          dependencies,
          statement: statementFunction,
          stepFunction,
        };
      },
    };
  };
