import { whenBuilder } from "../src/when";
import { intParser, stringParser } from "../src/parsers";
import { SampleGivenState, SampleWhenState } from "./testUtils";

// Simplest possible example
whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .step(() => {
    return {
      e: "action",
    };
  });

// Simple promise example
whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .step(async () => {
    return {
      e: "action",
    };
  });

// Simple dependency on given state example
whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .dependencies({
    given: {
      a: "required",
    },
  })
  .step(({ given }) => {
    return {
      e: `Action with ${given.a}`,
    };
  });

// Simple dependency on when state example
whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .dependencies({
    when: {
      d: "required",
    },
  })
  .step(({ when }) => {
    return {
      e: `Action with ${when.d}`,
    };
  });

// Variables example
whenBuilder<SampleGivenState, SampleWhenState>()
  .variables({ v1: stringParser, v2: intParser })
  .statement(v => `When a user does ${v.v1} ${v.v2} times`)
  .step(({ variables: { v1, v2 } }) => {
    return {
      e: `Action ${v1} ${v2}`,
    };
  });

// Complex example with both dependencies
whenBuilder<SampleGivenState, SampleWhenState>()
  .variables({ v1: stringParser, v2: intParser })
  .statement(v => `When a user does ${v.v1} ${v.v2} times`)
  .dependencies({
    given: {
      a: "required",
      b: "optional",
    },
    when: {
      d: "required",
      e: "optional",
    },
  })
  .step(({ variables: { v1, v2 }, given: { a, b }, when: { d, e } }) => {
    return {
      e: `Action ${v1} ${v2} with ${a} ${b} ${d} ${e}`,
    };
  });

// A string statement keeps its exact literal type on `expression`
const stringMeta = whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .step(() => ({ e: "action" }));
export const exactExpression: "When a user does something" =
  stringMeta.expression;

// ----- Should not compile section ----

whenBuilder<SampleGivenState, SampleWhenState>()
  // @ts-expect-error - function statements are gone; declare variables with .variables()
  .statement((v1: string) => `When a user does ${v1}`);

// @ts-expect-error - Should not compile without a statement
whenBuilder<SampleGivenState, SampleWhenState>().step(() => {
  return {
    a: "action",
  };
});

whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  // @ts-expect-error - Should not compile since no variables are declared
  .step(({ variables: [v1, v2] }) => {
    return {
      a: `Action ${v1} ${v2}`,
    };
  });

whenBuilder<SampleGivenState, SampleWhenState>()
  .variables({ v1: stringParser })
  // @ts-expect-error - the statement can only interpolate declared variable names
  .statement(v => `When a user does ${v.nope}`)
  .step(({ variables: { v1 } }) => {
    return {
      e: `Action ${v1}`,
    };
  });

whenBuilder<SampleGivenState, SampleWhenState>()
  .variables({ v1: stringParser })
  .statement(v => `When a user does ${v.v1}`)
  // @ts-expect-error - only declared variable names exist on `variables`
  .step(({ variables: { v2 } }) => {
    return {
      e: `Action ${v2}`,
    };
  });

whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .dependencies({ given: { a: "required" } })
  .step(({ given }) => {
    return {
      // @ts-expect-error - Should not compile if we attempt to access a part of state that was not declared as a dependency
      e: `Action ${given.b}`,
    };
  });

whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .dependencies({ when: { d: "required" } })
  .step(({ when }) => {
    return {
      // @ts-expect-error - Should not compile if we attempt to access a part of state that was not declared as a dependency
      e: `Action ${when.f}`,
    };
  });

whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .dependencies({ given: { a: "optional" } })
  .step(({ given }) => {
    // @ts-expect-error - Should not compile since a is optional and can be undefined
    const strictA: string = given.a;
    return {
      e: `Action ${strictA}`,
    };
  });

whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .dependencies({ when: { e: "optional" } })
  .step(({ when }) => {
    // @ts-expect-error - Should not compile since e is optional and can be undefined
    const strictE: string = when.e;
    return {
      f: [strictE.length],
    };
  });

whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  // @ts-expect-error - Should not compile since the return type is not a partial of when state
  .step(() => {
    return {
      a: "hello",
    };
  });
