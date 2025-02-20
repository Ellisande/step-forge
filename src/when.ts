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

const whenDependencies =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState,
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
  >(dependencies: {
    given?: GivenDeps;
    when?: WhenDeps;
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
    type Dependencies = {
      given: GivenDeps;
      when: WhenDeps;
      then: EmptyObject;
    };
    const fullDependencies: Dependencies = {
      given: dependencies.given ?? ({} as GivenDeps),
      when: dependencies.when ?? ({} as WhenDeps),
      then: {},
    };
    return {
      step: addStep<
        ResolvedStepType,
        Statement,
        Dependencies,
        Variables,
        GivenState,
        WhenState,
        never,
        RestrictedGivenState,
        RestrictedWhenState,
        never,
        Parsers
      >(statement, stepType, fullDependencies, parsers),
    };
  };

const whenParsers =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState
  >(
    statement: Statement,
    stepType: ResolvedStepType
  ) => <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }>(parsers: Parsers) => {
    type ParserOutputTypes = {
      [K in keyof Parsers]: Parsers[K] extends Parser<infer T> ? T : never;
    };
    return {
      dependencies: whenDependencies<
        Statement,
        ResolvedStepType,
        ParserOutputTypes,
        GivenState,
        WhenState,
        Parsers
      >(statement, stepType, parsers),
      step: addStep<
        ResolvedStepType,
        Statement,
        EmptyDependencies,
        ParserOutputTypes,
        GivenState,
        WhenState,
        never,
        never,
        never,
        never,
        Parsers
      >(statement, stepType, undefined, parsers),
    };
  };

const whenStatement =
  <ResolvedStepType extends StepType, GivenState, WhenState>(
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
    
    const dependencyFunc = whenDependencies<
      NormalizedStatement,
      ResolvedStepType,
      StringifiedVariables,
      GivenState,
      WhenState
    >(normalizedStatement, stepType);
    const parsersFunc = whenParsers<
      NormalizedStatement,
      ResolvedStepType,
      Variables,
      GivenState,
      WhenState
    >(normalizedStatement, stepType); 
    const stepFunc = addStep<
      ResolvedStepType,
      NormalizedStatement,
      EmptyDependencies,
      StringifiedVariables,
      GivenState,
      WhenState,
      never,
      never,
      never,
      never
    >(normalizedStatement, stepType);
    return {
      dependencies: dependencyFunc,
      parsers: parsersFunc,
      step: stepFunc,
    };
  };

export const whenBuilder = <GivenState, WhenState>() => {
  return {
    statement: whenStatement<"when", GivenState, WhenState>("when"),
  };
};
