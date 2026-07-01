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

const whenDependencies =
  <Variables, GivenState, WhenState>(
    statement: (...args: any[]) => string,
    parsers?: Parser<any>[]
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
      WhenOutput<WhenState>
    >(
      statement,
      WHEN,
      {
        given: dependencies.given ?? {},
        when: dependencies.when ?? {},
        then: {},
      } as FullDependencies,
      parsers
    ),
  });

const whenParsers =
  <Variables extends any[], GivenState, WhenState>(
    statement: (...args: any[]) => string
  ) =>
  <Parsers extends { [K in keyof Variables]: Parser<Variables[K]> }>(
    parsers: Parsers
  ) => ({
    dependencies: whenDependencies<Variables, GivenState, WhenState>(
      statement,
      parsers as unknown as Parser<any>[]
    ),
    step: addStep<WhenInput<Variables, never, never>, WhenOutput<WhenState>>(
      statement,
      WHEN,
      undefined,
      parsers as unknown as Parser<any>[]
    ),
  });

const whenStatement =
  <GivenState, WhenState>() =>
  <Statement extends ((...args: [...any]) => string) | string>(
    statement: Statement
  ) => {
    const normalizedStatement: (...args: any[]) => string = isString(statement)
      ? () => statement
      : (statement as (...args: any[]) => string);

    type Variables = Statement extends string ? [] : GetFunctionArgs<Statement>;
    return {
      dependencies: whenDependencies<Variables, GivenState, WhenState>(
        normalizedStatement
      ),
      parsers: whenParsers<Variables, GivenState, WhenState>(
        normalizedStatement
      ),
      step: addStep<WhenInput<Variables, never, never>, WhenOutput<WhenState>>(
        normalizedStatement,
        WHEN
      ),
    };
  };

export const whenBuilder = <GivenState, WhenState>() => ({
  statement: whenStatement<GivenState, WhenState>(),
});
