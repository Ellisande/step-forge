/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  FullDependencies,
  GetFunctionArgs,
  isString,
  RequiredOrOptional,
  Restrict,
  StepType,
} from "./builderTypeUtils";
import { addStep } from "./common";
import { Parser } from "./parsers";

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

const thenDependencies =
  <Variables, GivenState, WhenState, ThenState>(
    statement: (...args: any[]) => string,
    parsers?: Parser<any>[]
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
      ThenOutput<ThenState>
    >(
      statement,
      THEN,
      {
        given: dependencies.given ?? {},
        when: dependencies.when ?? {},
        then: dependencies.then ?? {},
      } as FullDependencies,
      parsers
    ),
  });

const thenParsers =
  <Variables extends any[], GivenState, WhenState, ThenState>(
    statement: (...args: any[]) => string
  ) =>
  <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }>(
    parsers: Parsers
  ) => ({
    dependencies: thenDependencies<Variables, GivenState, WhenState, ThenState>(
      statement,
      parsers as unknown as Parser<any>[]
    ),
    step: addStep<
      ThenInput<Variables, never, never, never>,
      ThenOutput<ThenState>
    >(statement, THEN, undefined, parsers as unknown as Parser<any>[]),
  });

const thenStatement =
  <GivenState, WhenState, ThenState>() =>
  <Statement extends ((...args: [...any]) => string) | string>(
    statement: Statement
  ) => {
    const normalizedStatement: (...args: any[]) => string = isString(statement)
      ? () => statement
      : (statement as (...args: any[]) => string);

    type Variables = Statement extends string ? [] : GetFunctionArgs<Statement>;
    return {
      dependencies: thenDependencies<
        Variables,
        GivenState,
        WhenState,
        ThenState
      >(normalizedStatement),
      parsers: thenParsers<Variables, GivenState, WhenState, ThenState>(
        normalizedStatement
      ),
      step: addStep<
        ThenInput<Variables, never, never, never>,
        ThenOutput<ThenState>
      >(normalizedStatement, THEN),
    };
  };

export const thenBuilder = <GivenState, WhenState, ThenState>() => ({
  statement: thenStatement<GivenState, WhenState, ThenState>(),
});
