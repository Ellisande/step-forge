import { givenBuilder } from "../src/given";
import { intParser, stringParser } from "../src/parsers";
import { SampleGivenState } from "./testUtils";

// Simplest possible example
givenBuilder<SampleGivenState>()
  .statement("Given a user")
  .step(() => {
    return {
      a: "user",
    };
  });

// Simple promise example
givenBuilder<SampleGivenState>()
  .statement("Given a user")
  .step(async () => {
    return {
      a: "user",
    };
  });

// Simple dependency example
givenBuilder<SampleGivenState>()
  .statement("Given a user")
  .dependencies({
    given: {
      a: "required",
    },
  })
  .step(({ given }) => {
    return {
      b: `I love ${given.a}`,
    };
  });

// Variables example - variables arrive as a name-keyed object typed by each
// parser's return type
givenBuilder<SampleGivenState>()
  .variables({ v1: stringParser, v2: intParser })
  .statement(v => `Given a user ${v.v1} ${v.v2}`)
  .step(({ variables: { v1, v2 } }) => {
    const name: string = v1;
    const amount: number = v2;
    return {
      b: `I love ${name} ${amount}`,
    };
  });

// Complex example - variables chain into dependencies
givenBuilder<SampleGivenState>()
  .variables({ v1: stringParser, v2: intParser })
  .statement(v => `Given a user ${v.v1} ${v.v2}`)
  .dependencies({
    given: {
      a: "required",
      b: "optional",
      c: "required",
    },
  })
  .step(({ variables: { v1, v2 }, given: { a, b, c } }) => {
    return {
      b: `I love ${v1} ${v2} ${a} ${b} ${c}`,
    };
  });

// A string statement keeps its exact literal type on `expression`
const stringMeta = givenBuilder<SampleGivenState>()
  .statement("Given a user")
  .step(() => ({ a: "user" }));
export const exactExpression: "Given a user" = stringMeta.expression;

// A token statement keeps a `${string}`-holed template type on `expression`
const namedMeta = givenBuilder<SampleGivenState>()
  .variables({ v1: stringParser })
  .statement(v => `Given a user ${v.v1}`)
  .step(({ variables: { v1 } }) => ({ b: v1 }));
export const templateExpression: `Given a user ${string}` =
  namedMeta.expression;

// ----- Should not compile section ----

givenBuilder<SampleGivenState>()
  // @ts-expect-error - function statements are gone; declare variables with .variables()
  .statement((v1: string) => `Given a user ${v1}`);

// @ts-expect-error - Should not compile without a statement
givenBuilder<SampleGivenState>().step(() => {
  return {
    a: "user",
  };
});

givenBuilder<SampleGivenState>()
  .statement("Given a user")
  // @ts-expect-error - Should not compile since no variables are declared
  .step(({ variables: [v1, v2] }) => {
    return {
      a: `I love ${v1} ${v2}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement("Given a user")
  // @ts-expect-error - Should not compile since no variables are declared
  .step(({ variables: { v1 } }) => {
    return {
      a: `I love ${v1}`,
    };
  });

givenBuilder<SampleGivenState>()
  // @ts-expect-error - variables map values must be parsers
  .variables({ v1: 42 })
  .statement(v => `Given a user ${v.v1}`)
  .step(() => {
    return {
      a: "user",
    };
  });

givenBuilder<SampleGivenState>()
  .variables({ v1: stringParser })
  // @ts-expect-error - the statement can only interpolate declared variable names
  .statement(v => `Given a user ${v.nope}`)
  .step(({ variables: { v1 } }) => {
    return {
      b: `I love ${v1}`,
    };
  });

givenBuilder<SampleGivenState>()
  .variables({ v1: intParser })
  // @ts-expect-error - tokens are opaque placeholders, not usable as values
  .statement(v => `Given a user ${v.v1 * 2}`)
  .step(({ variables: { v1 } }) => {
    return {
      b: `I love ${v1}`,
    };
  });

givenBuilder<SampleGivenState>()
  .variables({ v1: intParser })
  .statement(v => `Given a user ${v.v1}`)
  .step(({ variables: { v1 } }) => {
    // @ts-expect-error - v1 came from intParser, so it is a number, not a string
    const name: string = v1;
    return {
      b: `I love ${name}`,
    };
  });

givenBuilder<SampleGivenState>()
  .variables({ v1: stringParser })
  .statement(v => `Given a user ${v.v1}`)
  // @ts-expect-error - only declared variable names exist on `variables`
  .step(({ variables: { v2 } }) => {
    return {
      b: `I love ${v2}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement("Given a user")
  .dependencies({ given: { a: "required" } })
  .step(({ given }) => {
    return {
      // @ts-expect-error - Should not compile if we attempt to access a part of state that was not declared as a dependency
      b: `I love ${given.b}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement("a user")
  // @ts-expect-error - Should not compile if we attempt to access a part of state that was not declared as a dependency
  .dependencies({ when: { a: "required" } })
  .step(({ when }) => {
    return {
      // @ts-expect-error - Should not compile if we attempt to access a part of state that was not declared as a dependency
      b: `I love ${when.c}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement("Given a user")
  .dependencies({ given: { a: "optional" } })
  .step(({ given }) => {
    // @ts-expect-error - Should not compile since a is optional and can be undefined
    const strictA: string = given.a;
    return {
      b: `I love ${strictA}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement("Given a user")
  // @ts-expect-error - Should not compile since the return type is not a partial of given state
  .step(() => {
    return {
      f: "hello",
    };
  });
