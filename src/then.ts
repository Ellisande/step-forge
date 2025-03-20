/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  EmptyDependencies,
  GetFunctionArgs,
  isString,
  RequiredOrOptional,
  StepType,
} from "./builderTypeUtils";
import { addStep } from "./common";
import { Parser } from "./parsers";

const thenDependencies =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState,
    ThenState,
    Parsers extends { [K in keyof Variables]: Parser<any> } = {
      [K in keyof Variables]: Parser<string>
    }
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    parsers?: Parsers
  ) =>
  <
    GivenDeps extends RequiredOrOptional<GivenState>,
    WhenDeps extends RequiredOrOptional<WhenState>,
    ThenDeps extends RequiredOrOptional<ThenState>,
  >(dependencies: {
    given?: GivenDeps;
    when?: WhenDeps;
    then?: ThenDeps;
  }) => {
    type RestrictedGivenState = {
      [K in keyof GivenState as K extends keyof GivenDeps
        ? K
        : never]: GivenDeps[K] extends "optional"
        ? GivenState[K] | undefined
        : GivenState[K];
    };
    type RestrictedWhenState = {
      [K in keyof WhenState as K extends keyof WhenDeps
        ? K
        : never]: WhenDeps[K] extends "optional"
        ? WhenState[K] | undefined
        : WhenState[K];
    };
    type RestrictedThenState = {
      [K in keyof ThenState as K extends keyof ThenDeps
        ? K
        : never]: ThenDeps[K] extends "optional"
        ? ThenState[K] | undefined
        : ThenState[K];
    };
    type Dependencies = {
      given: GivenDeps;
      when: WhenDeps;
      then: ThenDeps;
    };
    const fullDependencies: Dependencies = {
      given: dependencies.given ?? ({} as GivenDeps),
      when: dependencies.when ?? ({} as WhenDeps),
      then: dependencies.then ?? ({} as ThenDeps),
    };
    return {
      step: addStep<
        ResolvedStepType,
        Statement,
        Dependencies,
        Variables,
        GivenState,
        WhenState,
        ThenState,
        RestrictedGivenState,
        RestrictedWhenState,
        RestrictedThenState,
        Parsers
      >(statement, stepType, fullDependencies, parsers),
    };
  };

const thenParsers =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState,
    ThenState
  >(
    statement: Statement,
    stepType: ResolvedStepType
  ) => <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }>(parsers: Parsers) => {
    type ParserOutputTypes = {
      [K in keyof Parsers]: Parsers[K] extends Parser<infer T> ? T : never;
    };
    return {
      dependencies: thenDependencies<
        Statement,
        ResolvedStepType,
        ParserOutputTypes,
        GivenState,
        WhenState,
        ThenState,
        Parsers
      >(statement, stepType, parsers),
      step: addStep<
        ResolvedStepType,
        Statement,
        EmptyDependencies,
        ParserOutputTypes,
        GivenState,
        WhenState,
        ThenState,
        never,
        never,
        never,
        Parsers
      >(statement, stepType, undefined, parsers),
    };
  };

const thenStatement =
  <ResolvedStepType extends StepType, GivenState, WhenState, ThenState>(
    stepType: ResolvedStepType
  ) =>
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

    const dependencyFunc = thenDependencies<
      NormalizedStatement,
      ResolvedStepType,
      StringifiedVariables,
      GivenState,
      WhenState,
      ThenState,
      never
    >(normalizedStatement, stepType);
    const stepFunc = addStep<
      ResolvedStepType,
      NormalizedStatement,
      EmptyDependencies,
      StringifiedVariables,
      GivenState,
      WhenState,
      ThenState,
      never,
      never,
      never
    >(normalizedStatement, stepType);
    const parsersFunc = thenParsers<
      NormalizedStatement,
      ResolvedStepType,
      Variables,
      GivenState,
      WhenState,
      ThenState
    >(normalizedStatement, stepType);
    return {
      dependencies: dependencyFunc,
      parsers: parsersFunc,
      step: stepFunc,
    };
  };

export const thenBuilder = <GivenState, WhenState, ThenState>() => {
  return {
    statement: thenStatement<"then", GivenState, WhenState, ThenState>("then"),
  };
};
