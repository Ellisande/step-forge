/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  EmptyObject,
  GetFunctionArgs,
  isString,
  RequiredOrOptional,
  StepType,
} from "./builderTypeUtils";
import { addStep } from "./common";

const whenDependencies =
  <
    Statement,
    ResolvedStepType extends StepType,
    Variables,
    GivenState,
    WhenState,
  >(
    statement: Statement,
    stepType: ResolvedStepType
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
      given?: GivenDeps;
      when?: WhenDeps;
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
        never
      >(statement, stepType, dependencies),
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
      EmptyObject,
      Variables,
      GivenState,
      WhenState,
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

export const whenBuilder = <GivenState, WhenState>() => {
  return {
    statement: whenStatement<"when", GivenState, WhenState>("when"),
  };
};
