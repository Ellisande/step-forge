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
  | Partial<GivenState>
  | Promise<Partial<GivenState>>;

const givenDependencies =
  <Variables, GivenState>(
    statement: (...args: any[]) => string,
    parsers?: Parser<any>[]
  ) =>
  <GivenDeps extends RequiredOrOptional<GivenState>>(dependencies: {
    given: GivenDeps;
  }) => ({
    step: addStep<
      GivenInput<Variables, Restrict<GivenState, GivenDeps>>,
      GivenOutput<GivenState>
    >(
      statement,
      GIVEN,
      { ...dependencies, when: {}, then: {} } as FullDependencies,
      parsers
    ),
  });

const givenParsers =
  <Variables extends any[], GivenState>(
    statement: (...args: any[]) => string
  ) =>
  <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }>(
    parsers: Parsers
  ) => ({
    dependencies: givenDependencies<Variables, GivenState>(
      statement,
      parsers as unknown as Parser<any>[]
    ),
    step: addStep<GivenInput<Variables, never>, GivenOutput<GivenState>>(
      statement,
      GIVEN,
      undefined,
      parsers as unknown as Parser<any>[]
    ),
  });

const givenStatement =
  <GivenState>() =>
  <Statement extends ((...args: [...any]) => string) | string>(
    statement: Statement
  ) => {
    const normalizedStatement: (...args: any[]) => string = isString(statement)
      ? () => statement
      : (statement as (...args: any[]) => string);

    type Variables = Statement extends string ? [] : GetFunctionArgs<Statement>;
    return {
      dependencies: givenDependencies<Variables, GivenState>(
        normalizedStatement
      ),
      parsers: givenParsers<Variables, GivenState>(normalizedStatement),
      step: addStep<GivenInput<Variables, never>, GivenOutput<GivenState>>(
        normalizedStatement,
        GIVEN
      ),
    };
  };

export const givenBuilder = <GivenState>() => ({
  statement: givenStatement<GivenState>(),
});
