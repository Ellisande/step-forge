/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  EmptyDependencies,
  GetFunctionArgs,
  isString,
  RequiredOrOptional,
  StepType,
} from "./builderTypeUtils";
import { addStep } from "./common";
import { Parser, TableParser } from "./parsers";

const thenDependencies =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState,
    ThenState,
    Table = undefined,
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    parsers?: Parser<any>[],
    table?: TableParser<Table>
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
        Table
      >(statement, stepType, fullDependencies, parsers, table),
    };
  };

const thenTable =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState,
    ThenState,
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    parsers?: Parser<any>[]
  ) =>
  <T>(table: TableParser<T>) => {
    return {
      dependencies: thenDependencies<
        Statement,
        ResolvedStepType,
        Variables,
        GivenState,
        WhenState,
        ThenState,
        T
      >(statement, stepType, parsers, table),
      step: addStep<
        ResolvedStepType,
        Statement,
        EmptyDependencies,
        Variables,
        GivenState,
        WhenState,
        ThenState,
        never,
        never,
        never,
        T
      >(statement, stepType, undefined, parsers, table),
    };
  };

const thenParsers =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables extends any[],
    GivenState,
    WhenState,
    ThenState,
  >(
    statement: Statement,
    stepType: ResolvedStepType
  ) =>
  <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }>(
    parsers: Parsers
  ) => {
    return {
      dependencies: thenDependencies<
        Statement,
        ResolvedStepType,
        Variables,
        GivenState,
        WhenState,
        ThenState
      >(statement, stepType, parsers as unknown as Parser<any>[]),
      table: thenTable<
        Statement,
        ResolvedStepType,
        Variables,
        GivenState,
        WhenState,
        ThenState
      >(statement, stepType, parsers as unknown as Parser<any>[]),
      step: addStep<
        ResolvedStepType,
        Statement,
        EmptyDependencies,
        Variables,
        GivenState,
        WhenState,
        ThenState,
        never,
        never,
        never
      >(statement, stepType, undefined, parsers as unknown as Parser<any>[]),
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
    const dependencyFunc = thenDependencies<
      NormalizedStatement,
      ResolvedStepType,
      Variables,
      GivenState,
      WhenState,
      ThenState
    >(normalizedStatement, stepType);
    const parsersFunc = thenParsers<
      NormalizedStatement,
      ResolvedStepType,
      Variables,
      GivenState,
      WhenState,
      ThenState
    >(normalizedStatement, stepType);
    const tableFunc = thenTable<
      NormalizedStatement,
      ResolvedStepType,
      Variables,
      GivenState,
      WhenState,
      ThenState
    >(normalizedStatement, stepType);
    const stepFunc = addStep<
      ResolvedStepType,
      NormalizedStatement,
      EmptyDependencies,
      Variables,
      GivenState,
      WhenState,
      ThenState,
      never,
      never,
      never
    >(normalizedStatement, stepType);
    return {
      dependencies: dependencyFunc,
      parsers: parsersFunc,
      table: tableFunc,
      step: stepFunc,
    };
  };

export const thenBuilder = <GivenState, WhenState, ThenState>() => {
  return {
    statement: thenStatement<"then", GivenState, WhenState, ThenState>("then"),
  };
};
