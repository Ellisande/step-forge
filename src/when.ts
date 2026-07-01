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
import { Parser, TableParser } from "./parsers";

const whenDependencies =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState,
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
        Table
      >(statement, stepType, fullDependencies, parsers, table),
    };
  };

const whenTable =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState,
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    parsers?: Parser<any>[]
  ) =>
  <T>(table: TableParser<T>) => {
    return {
      dependencies: whenDependencies<
        Statement,
        ResolvedStepType,
        Variables,
        GivenState,
        WhenState,
        T
      >(statement, stepType, parsers, table),
      step: addStep<
        ResolvedStepType,
        Statement,
        EmptyDependencies,
        Variables,
        GivenState,
        WhenState,
        never,
        never,
        never,
        never,
        T
      >(statement, stepType, undefined, parsers, table),
    };
  };

const whenParsers =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables extends any[],
    GivenState,
    WhenState,
  >(
    statement: Statement,
    stepType: ResolvedStepType
  ) =>
  <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }>(
    parsers: Parsers
  ) => {
    return {
      dependencies: whenDependencies<
        Statement,
        ResolvedStepType,
        Variables,
        GivenState,
        WhenState
      >(statement, stepType, parsers as unknown as Parser<any>[]),
      table: whenTable<
        Statement,
        ResolvedStepType,
        Variables,
        GivenState,
        WhenState
      >(statement, stepType, parsers as unknown as Parser<any>[]),
      step: addStep<
        ResolvedStepType,
        Statement,
        EmptyDependencies,
        Variables,
        GivenState,
        WhenState,
        never,
        never,
        never,
        never
      >(statement, stepType, undefined, parsers as unknown as Parser<any>[]),
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
    const dependencyFunc = whenDependencies<
      NormalizedStatement,
      ResolvedStepType,
      Variables,
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
    const tableFunc = whenTable<
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
      Variables,
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
      table: tableFunc,
      step: stepFunc,
    };
  };

export const whenBuilder = <GivenState, WhenState>() => {
  return {
    statement: whenStatement<"when", GivenState, WhenState>("when"),
  };
};
