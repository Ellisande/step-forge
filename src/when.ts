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
  ) => <Parsers extends { [K in keyof Variables]: Parser<any> }>(parsers: Parsers) => {
    return {
      dependencies: whenDependencies<
        Statement,
        ResolvedStepType,
        Variables,
        GivenState,
        WhenState,
        Parsers
      >(statement, stepType, parsers),
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
      parsers: whenParsers<
        NormalizedStatement,
        ResolvedStepType,
        Variables,
        GivenState,
        WhenState
      >(normalizedStatement, stepType),
      step: stepFunc,
    };
  };

export const whenBuilder = <GivenState, WhenState>() => {
  return {
    statement: whenStatement<"when", GivenState, WhenState>("when"),
  };
};
