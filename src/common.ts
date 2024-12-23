import { HasKeys } from "./builderTypeUtils";

import { StepType } from "./builderTypeUtils";

export const addStep =
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
