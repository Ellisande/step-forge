/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  FullDependencies,
  RequiredOrOptional,
  Restrict,
  StepType,
} from "./builderTypeUtils";
import { addStep } from "./common";
import {
  NoVariables,
  VariableMap,
  VariablesOf,
  VariableTokens,
} from "./variables";

const WHEN: StepType = "when";

// The object a when step receives: `given` and `when` are reachable (narrowed to
// declared dependencies, or `never` when none), `then` is always out of reach.
type WhenInput<Variables, Given, When> = {
  variables: Variables;
  given: Given;
  when: When;
  then: never;
};
type WhenOutput<WhenState> = Partial<WhenState> | Promise<Partial<WhenState>>;

// Shared dependencies stage for both entry styles; see given.ts for the shape.
const whenDependencies =
  <Variables, Expr extends string, GivenState, WhenState>(
    statement: (tokens: any) => string,
    variables: VariableMap
  ) =>
  <
    GivenDeps extends RequiredOrOptional<GivenState>,
    WhenDeps extends RequiredOrOptional<WhenState>,
  >(dependencies: {
    given?: GivenDeps;
    when?: WhenDeps;
  }) => ({
    step: addStep<
      WhenInput<
        Variables,
        Restrict<GivenState, GivenDeps>,
        Restrict<WhenState, WhenDeps>
      >,
      WhenOutput<WhenState>,
      Expr
    >(
      statement,
      WHEN,
      {
        given: dependencies.given ?? {},
        when: dependencies.when ?? {},
        then: {},
      } as FullDependencies,
      variables
    ),
  });

// The `{dependencies, step}` stage both entry styles land on, with `Variables`
// already resolved to what the step function sees.
const whenChain = <Variables, Expr extends string, GivenState, WhenState>(
  statement: (tokens: any) => string,
  variables: VariableMap
) => ({
  dependencies: whenDependencies<Variables, Expr, GivenState, WhenState>(
    statement,
    variables
  ),
  step: addStep<
    WhenInput<Variables, never, never>,
    WhenOutput<WhenState>,
    Expr
  >(statement, WHEN, undefined, variables),
});

// The variable chain: `.variables({name: parser}).statement(v => ...)`; see
// given.ts for the pattern.
const whenVariables =
  <GivenState, WhenState>() =>
  <Map extends VariableMap>(variables: Map) => ({
    statement: <Expr extends string>(
      statement: (tokens: VariableTokens<Map>) => Expr
    ) =>
      whenChain<VariablesOf<Map>, Expr, GivenState, WhenState>(
        statement,
        variables
      ),
  });

// A statement with no variables is a plain string; `Expr` keeps its exact
// literal type on the registered step's `expression`.
const whenStatement =
  <GivenState, WhenState>() =>
  <Expr extends string>(statement: Expr) =>
    whenChain<NoVariables, Expr, GivenState, WhenState>(() => statement, {});

export const whenBuilder = <GivenState, WhenState>() => ({
  statement: whenStatement<GivenState, WhenState>(),
  variables: whenVariables<GivenState, WhenState>(),
});
