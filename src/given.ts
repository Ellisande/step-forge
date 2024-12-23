/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  EmptyObject,
  GetFunctionArgs,
  isString,
  RequiredOrOptional,
  StepType,
} from "./builderTypeUtils";
import { addStep } from "./common";

const givenDependencies =
  <Statement, ResolvedStepType extends StepType, Variables, GivenState>(
    statement: Statement,
    stepType: ResolvedStepType
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
    type Dependencies = {
      given: GivenDeps;
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
      >(statement, stepType, dependencies),
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
    const stepFunc = addStep<
      ResolvedStepType,
      NormalizedStatement,
      EmptyObject,
      Variables,
      GivenState,
      never,
      never,
      never,
      never,
      never
    >(normalizedStatement, stepType, {});
    return {
      dependencies: dependencyFunc,
      step: stepFunc,
    };
  };

export const givenBuilder = <GivenState>() => {
  return {
    statement: givenStatement<"given", GivenState>("given"),
  };
};
