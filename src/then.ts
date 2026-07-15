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

const THEN: StepType = "then";

// The object a then step receives: all three phases are reachable (each narrowed
// to declared dependencies, or `never` when none). Then steps may also return
// nothing (assertion-only), hence the `void` in the output type.
type ThenInput<Variables, Given, When, Then> = {
  variables: Variables;
  given: Given;
  when: When;
  then: Then;
};
type ThenOutput<ThenState> =
  Partial<ThenState> | Promise<Partial<ThenState>> | void | Promise<void>;

// Shared dependencies stage for both entry styles; see given.ts for the shape.
const thenDependencies =
  <Variables, Expr extends string, GivenState, WhenState, ThenState>(
    statement: (tokens: any) => string,
    variables: VariableMap
  ) =>
  <
    GivenDeps extends RequiredOrOptional<GivenState>,
    WhenDeps extends RequiredOrOptional<WhenState>,
    ThenDeps extends RequiredOrOptional<ThenState>,
  >(dependencies: {
    given?: GivenDeps;
    when?: WhenDeps;
    then?: ThenDeps;
  }) => ({
    step: addStep<
      ThenInput<
        Variables,
        Restrict<GivenState, GivenDeps>,
        Restrict<WhenState, WhenDeps>,
        Restrict<ThenState, ThenDeps>
      >,
      ThenOutput<ThenState>,
      Expr
    >(
      statement,
      THEN,
      {
        given: dependencies.given ?? {},
        when: dependencies.when ?? {},
        then: dependencies.then ?? {},
      } as FullDependencies,
      variables
    ),
  });

// The `{dependencies, step}` stage both entry styles land on, with `Variables`
// already resolved to what the step function sees.
const thenChain = <
  Variables,
  Expr extends string,
  GivenState,
  WhenState,
  ThenState,
>(
  statement: (tokens: any) => string,
  variables: VariableMap
) => ({
  dependencies: thenDependencies<
    Variables,
    Expr,
    GivenState,
    WhenState,
    ThenState
  >(statement, variables),
  step: addStep<
    ThenInput<Variables, never, never, never>,
    ThenOutput<ThenState>,
    Expr
  >(statement, THEN, undefined, variables),
});

// The variable chain: `.variables({name: parser}).statement(v => ...)`; see
// given.ts for the pattern.
const thenVariables =
  <GivenState, WhenState, ThenState>() =>
  <Map extends VariableMap>(variables: Map) => ({
    statement: <Expr extends string>(
      statement: (tokens: VariableTokens<Map>) => Expr
    ) =>
      thenChain<VariablesOf<Map>, Expr, GivenState, WhenState, ThenState>(
        statement,
        variables
      ),
  });

// A statement with no variables is a plain string; `Expr` keeps its exact
// literal type on the registered step's `expression`.
const thenStatement =
  <GivenState, WhenState, ThenState>() =>
  <Expr extends string>(statement: Expr) =>
    thenChain<NoVariables, Expr, GivenState, WhenState, ThenState>(
      () => statement,
      {}
    );

export const thenBuilder = <GivenState, WhenState, ThenState>() => ({
  statement: thenStatement<GivenState, WhenState, ThenState>(),
  variables: thenVariables<GivenState, WhenState, ThenState>(),
});
