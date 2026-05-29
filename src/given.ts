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
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    parsers?: Parser<any>[]
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
        never, // when state
        never, // then state
        RestrictedGivenState,
        never, // restricted when state
        never // restricted then state
      >(statement, stepType, fullDependencies, parsers),
    };
  };

const givenParsers =
  <
    Statement extends (...args: any[]) => string,
    ResolvedStepType extends StepType,
    Variables extends any[],
    GivenState,
  >(
    statement: Statement,
    stepType: ResolvedStepType
  ) =>
  <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }>(
    parsers: Parsers
  ) => {
    return {
      dependencies: givenDependencies<
        Statement,
        ResolvedStepType,
        Variables,
        GivenState
      >(statement, stepType, parsers as unknown as Parser<any>[]),
      step: addStep<
        ResolvedStepType,
        Statement,
        EmptyDependencies,
        Variables,
        GivenState,
        never,
        never,
        never,
        never,
        never
      >(statement, stepType, undefined, parsers as unknown as Parser<any>[]),
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
    const dependencyFunc = givenDependencies<
      NormalizedStatement,
      ResolvedStepType,
      Variables,
      GivenState
    >(normalizedStatement, stepType);
    const parsersFunc = givenParsers<
      NormalizedStatement,
      ResolvedStepType,
      Variables,
      GivenState
    >(normalizedStatement, stepType);
    const stepFunc = addStep<
      ResolvedStepType,
      NormalizedStatement,
      EmptyDependencies,
      Variables,
      GivenState,
      never,
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

export const givenBuilder = <GivenState>() => {
  return {
    statement: givenStatement<"given", GivenState>("given"),
  };
};
