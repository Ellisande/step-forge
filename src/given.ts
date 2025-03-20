/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  EmptyDependencies,
  EmptyObject,
  GetFunctionArgs,
  isString,
  RequiredOrOptional,
  StepType,
} from "./builderTypeUtils";
import { addStep } from "./common";
import { Parser } from "./parsers";

const givenDependencies =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    Parsers extends { [K in keyof Variables]: Parser<any> } = {
      [K in keyof Variables]: Parser<string>
    }
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    parsers?: Parsers
  ) =>
  <GivenDeps extends RequiredOrOptional<GivenState>>(dependencies: {
    given: GivenDeps;
  }) => {
    type RestrictedGivenState = {
      [K in keyof GivenState as K extends keyof GivenDeps
        ? K
        : never]: GivenDeps[K] extends "optional"
        ? GivenState[K] | undefined
        : GivenState[K];
    };
    type Dependencies = typeof dependencies & {
      when: EmptyObject;
      then: EmptyObject;
    };
    const fullDependencies = {
      ...dependencies,
      when: {},
      then: {},
    };
    return {
      step: addStep<
        ResolvedStepType,
        Statement,
        Dependencies,
        Variables,
        GivenState,
        never,
        never,
        RestrictedGivenState,
        never,
        never,
        Parsers
      >(statement, stepType, fullDependencies, parsers),
    };
  };

  // TODO: Needs to optionally chain to step, not be required to go through dependencies
const givenParsers =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState
  >(
    statement: Statement,
    stepType: ResolvedStepType
  ) => <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }> // [string, int, boolean] => [Parser<string>, Parser<int>, Parser<boolean>] => [string, int, boolean]
  (parsers: Parsers) => {
    // Can't use a utility type here because it needs information on the exact length of the tuple, and its typing
    type ParserOutputTypes = {
      [K in keyof Parsers]: Parsers[K] extends Parser<infer T> ? T : never;
    };
    return {
      dependencies: givenDependencies<
        Statement,
        ResolvedStepType,
        ParserOutputTypes,
        GivenState,
        Parsers
      >(statement, stepType, parsers),
      step: addStep<
        ResolvedStepType,
        Statement,
        EmptyDependencies,
        ParserOutputTypes,
        GivenState,
        never,
        never,
        never,
        never,
        never,
        Parsers
      >(statement, stepType, undefined, parsers),
    };
  };

const givenStatement =
  <ResolvedStepType extends StepType, GivenState>(stepType: ResolvedStepType) =>
  <Statement extends ((...args: [...any]) => string) | string>(
    statement: Statement
  ) => {
    let normalizedStatement: Statement extends string
      ? () => string
      : Statement;
    if (isString(statement)) {
      normalizedStatement = (() => statement) as any;
    } else {
      normalizedStatement = statement as any;
    }
    type NormalizedStatement = typeof normalizedStatement;

    type Variables = Statement extends string ? [] : GetFunctionArgs<Statement>;
    type StringifiedTuple<T extends any[]> = { [I in keyof T]: string };
    type StringifiedVariables = StringifiedTuple<Variables>;

    const dependencyFunc = givenDependencies<
      NormalizedStatement,
      ResolvedStepType,
      StringifiedVariables,
      GivenState
    >(normalizedStatement, stepType);

    
    return {
      dependencies: dependencyFunc,
      parsers: givenParsers<
        NormalizedStatement,
        ResolvedStepType,
        Variables,
        GivenState
      >(normalizedStatement, stepType),
      step: addStep<
        ResolvedStepType,
        NormalizedStatement,
        EmptyDependencies,
        StringifiedVariables,
        GivenState,
        never,
        never,
        never,
        never,
        never
      >(normalizedStatement, stepType),
    };
  };

export const givenBuilder = <GivenState>() => {
  return {
    statement: givenStatement<"given", GivenState>("given"),
  };
};
