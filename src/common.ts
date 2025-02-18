/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Given as CucGiven,
  Then as CucThen,
  When as CucWhen,
} from "@cucumber/cucumber";
import _ from "lodash";

import { StepType } from "./builderTypeUtils";
import {
  requireFromGiven,
  requireFromThen,
  requireFromWhen,
} from "./utils";
import { MergeableWorld } from "./world";
import { Parser, stringParser } from "./parsers";
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
    Parsers extends { [K in keyof Variables]: Parser<any> } = {
      [K in keyof Variables]: Parser<string>
    }
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    dependencies: Dependencies = {
      given: {},
      when: {},
      then: {},
    } as Dependencies,
    declaredParsers?: Parsers
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
        : Partial<ThenState> | void
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
        const parsers = declaredParsers as unknown as Parser<any>[] ?? Array.from({ length: argCount }, () => stringParser) as Parser<any>[]; 
        const argMatchers = Array.from({ length: argCount }, (_, i) => parsers[i].gherkin);
        const statement = statementFunction(...argMatchers);

        const cucStepFunction = Object.defineProperty(
          async function (
            this: MergeableWorld<GivenState, WhenState, ThenState>,
            ...args: string[]
          ) {
            const coercedArgs = args
              .filter(arg => typeof arg !== 'function')
              .map((arg, index) => parsers[index].parse(arg));
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
