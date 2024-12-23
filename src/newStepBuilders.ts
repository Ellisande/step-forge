/* eslint-disable @typescript-eslint/no-explicit-any */
type StepType = "given" | "when" | "then";
// type InferAndReplace<T, U> = never extends T ? U : T;
type HasKeys<T> =
  T extends Record<any, any> ? (keyof T extends never ? never : T) : T;
type EmptyObject = Record<string, never>;
type RequiredOrOptional<T> = {
  [K in keyof T]?: "required" | "optional";
};
type GetFunctionArgs<T> = T extends (...args: infer A) => any ? A : never;

const addStep =
  <
    ResolvedStepType extends StepType,
    Statement,
    Dependencies,
    Variables,
    GivenState,
    WhenState,
    ThenState,
    RestrictedGivenState,
    RestrictedWhenState,
    RestrictedThenState,
  >(
    statement: Statement,
    stepType: ResolvedStepType,
    dependencies: Dependencies
  ) =>
  (
    stepFunction: (input: {
      variables: Variables;
      given: HasKeys<RestrictedGivenState>;
      when: HasKeys<RestrictedWhenState>;
      then: HasKeys<RestrictedThenState>;
    }) => ResolvedStepType extends "given"
      ? Partial<GivenState>
      : ResolvedStepType extends "when"
        ? Partial<WhenState>
        : Partial<ThenState>
  ) => {
    return {
      statement,
      dependencies,
      stepType,
      stepFunction,
      // TODO: Implement register later, but ultimately this should be the correct return
      register: () => ({
        statement,
        dependencies,
        stepType,
        stepFunction,
      }),
    };
  };

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

const isString = (
  statement: string | ((...args: [...any]) => string)
): statement is string => typeof statement === "string";

const givenStatement =
  <ResolvedStepType extends StepType, GivenState>(stepType: ResolvedStepType) =>
  <Statement extends ((...args: [...any]) => string) | string>(
    statement: Statement
  ) => {
    const possibleString = isString(statement);
    let normalizedStatement: Statement extends string
      ? () => string
      : Statement;
    if (possibleString) {
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
