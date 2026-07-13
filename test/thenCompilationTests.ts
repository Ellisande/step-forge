import { thenBuilder } from "../src/then";
import { intParser, stringParser } from "../src/parsers";
import {
  SampleGivenState,
  SampleThenState,
  SampleWhenState,
} from "./testUtils";

// Simplest possible example
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .step(() => {
    return {
      i: { j: "result" },
    };
  });

// Simple promise example
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .step(async () => {
    return {
      i: { j: "result" },
    };
  });

// Simple dependency on given state example
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({
    given: {
      a: "required",
    },
  })
  .step(({ given }) => {
    return {
      i: { j: `Result with ${given.a}` },
    };
  });

// Simple dependency on when state example
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({
    when: {
      d: "required",
    },
  })
  .step(({ when }) => {
    return {
      i: { j: `Result with ${when.d}` },
    };
  });

// Simple dependency on then state example
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({
    then: {
      g: "required",
    },
  })
  .step(({ then }) => {
    return {
      i: { j: `Result with ${then.g}` },
    };
  });

// Variables example
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .variables({ v1: stringParser, v2: intParser })
  .statement(v => `Then we should see ${v.v1} ${v.v2} times`)
  .step(({ variables: { v1, v2 } }) => {
    return {
      i: { j: `Result ${v1} ${v2}` },
    };
  });

// Complex example with all dependencies
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .variables({ v1: stringParser, v2: intParser })
  .statement(v => `Then we should see ${v.v1} ${v.v2} times`)
  .dependencies({
    given: {
      a: "required",
      b: "optional",
    },
    when: {
      d: "required",
      e: "optional",
    },
    then: {
      g: "required",
      h: "optional",
    },
  })
  .step(
    ({
      variables: { v1, v2 },
      given: { a, b },
      when: { d, e },
      then: { g, h },
    }) => {
      return {
        i: { j: `Result ${v1} ${v2} with ${a} ${b} ${d} ${e} ${g} ${h}` },
      };
    }
  );

// A string statement keeps its exact literal type on `expression`
const stringMeta = thenBuilder<
  SampleGivenState,
  SampleWhenState,
  SampleThenState
>()
  .statement("Then we should see something")
  .step(() => {});
export const exactExpression: "Then we should see something" =
  stringMeta.expression;

// ----- Should not compile section ----

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  // @ts-expect-error - function statements are gone; declare variables with .variables()
  .statement((v1: string) => `Then we should see ${v1}`);

// @ts-expect-error - Should not compile without a statement
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>().step(() => {
  return {
    i: { j: "result" },
  };
});

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  // @ts-expect-error - Should not compile since no variables are declared
  .step(({ variables: [v1, v2] }) => {
    return {
      i: { j: `Result ${v1} ${v2}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .variables({ v1: stringParser })
  // @ts-expect-error - the statement can only interpolate declared variable names
  .statement(v => `Then we should see ${v.nope}`)
  .step(({ variables: { v1 } }) => {
    return {
      i: { j: `Result ${v1}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .variables({ v1: stringParser })
  .statement(v => `Then we should see ${v.v1}`)
  // @ts-expect-error - only declared variable names exist on `variables`
  .step(({ variables: { v2 } }) => {
    return {
      i: { j: `Result ${v2}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({ given: { a: "required" } })
  .step(({ given }) => {
    return {
      // @ts-expect-error - Should not compile if we attempt to access a part of state that was not declared as a dependency
      i: { j: `Result ${given.b}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({ when: { d: "required" } })
  .step(({ when }) => {
    return {
      // @ts-expect-error - Should not compile if we attempt to access a part of state that was not declared as a dependency
      i: { j: `Result ${when.f}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({ then: { g: "required" } })
  .step(({ then }) => {
    return {
      // @ts-expect-error - Should not compile if we attempt to access a part of state that was not declared as a dependency
      i: { j: `Result ${then.i}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({ given: { a: "optional" } })
  .step(({ given }) => {
    // @ts-expect-error - Should not compile since a is optional and can be undefined
    const strictA: string = given.a;
    return {
      i: { j: `Result ${strictA}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({ when: { e: "optional" } })
  .step(({ when }) => {
    // @ts-expect-error - Should not compile since e is optional and can be undefined
    const strictE: string = when.e;
    return {
      i: { j: `Result ${strictE}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  .dependencies({ then: { h: "optional" } })
  .step(({ then }) => {
    // @ts-expect-error - Should not compile since h is optional and can be undefined
    const strictH: string = then.h;
    return {
      i: { j: `Result ${strictH}` },
    };
  });

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("Then we should see something")
  // @ts-expect-error - Should not compile since the return type is not a partial of then state
  .step(() => {
    return {
      a: "hello",
    };
  });
