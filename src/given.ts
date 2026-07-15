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

const GIVEN: StepType = "given";

// The `{ variables, given, when, then }` object a given step receives. Only
// `given` is reachable — when/then are `never`, enforcing phase restriction.
// `Given` is the state already narrowed to declared dependencies (`never` when
// no dependencies were declared).
type GivenInput<Variables, Given> = {
  variables: Variables;
  given: Given;
  when: never;
  then: never;
};
type GivenOutput<GivenState> =
  Partial<GivenState> | Promise<Partial<GivenState>>;

// Shared dependencies stage for both entry styles. `Variables` is already the
// resolved shape the step function sees (`VariablesOf<Map>` for a token
// statement, `NoVariables` for a string statement), so this stage carries no
// map generics of its own.
const givenDependencies =
  <Variables, Expr extends string, GivenState>(
    statement: (tokens: any) => string,
    variables: VariableMap
  ) =>
  <GivenDeps extends RequiredOrOptional<GivenState>>(dependencies: {
    given: GivenDeps;
  }) => ({
    step: addStep<
      GivenInput<Variables, Restrict<GivenState, GivenDeps>>,
      GivenOutput<GivenState>,
      Expr
    >(
      statement,
      GIVEN,
      { ...dependencies, when: {}, then: {} } as FullDependencies,
      variables
    ),
  });

// The `{dependencies, step}` stage both entry styles land on, with `Variables`
// already resolved to what the step function sees.
const givenChain = <Variables, Expr extends string, GivenState>(
  statement: (tokens: any) => string,
  variables: VariableMap
) => ({
  dependencies: givenDependencies<Variables, Expr, GivenState>(
    statement,
    variables
  ),
  step: addStep<GivenInput<Variables, never>, GivenOutput<GivenState>, Expr>(
    statement,
    GIVEN,
    undefined,
    variables
  ),
});

// The variable chain: `.variables({name: parser}).statement(v => ...)`. The
// map fixes the variable names and (through each parser) their types; the
// statement interpolates opaque tokens; the step function receives `variables`
// as a name-keyed object. `Expr` captures the statement's template type so the
// registered step's `expression` is a `${string}`-holed literal type.
const givenVariables =
  <GivenState>() =>
  <Map extends VariableMap>(variables: Map) => ({
    statement: <Expr extends string>(
      statement: (tokens: VariableTokens<Map>) => Expr
    ) => givenChain<VariablesOf<Map>, Expr, GivenState>(statement, variables),
  });

// A statement with no variables is a plain string; `Expr` keeps its exact
// literal type on the registered step's `expression`.
const givenStatement =
  <GivenState>() =>
  <Expr extends string>(statement: Expr) =>
    givenChain<NoVariables, Expr, GivenState>(() => statement, {});

export const givenBuilder = <GivenState>() => ({
  statement: givenStatement<GivenState>(),
  variables: givenVariables<GivenState>(),
});
