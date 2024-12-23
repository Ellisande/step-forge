import { whenBuilder } from "../src/when";
import { SampleGivenState, SampleWhenState } from "./testUtils";

// Simplest possible example
whenBuilder<SampleGivenState, SampleWhenState>()
  .statement("When a user does something")
  .step(() => {
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

// Simple variables example
whenBuilder<SampleGivenState, SampleWhenState>()
  .statement((v1: string, v2: number) => `When a user does ${v1} ${v2} times`)
  .step(({ variables: [v1, v2] }) => {
    return {
      e: `Action ${v1} ${v2}`,
    };
  });

// Complex example with both dependencies
whenBuilder<SampleGivenState, SampleWhenState>()
  .statement((v1: string, v2: number) => `When a user does ${v1} ${v2} times`)
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
  .step(({ variables: [v1, v2], given: { a, b }, when: { d, e } }) => {
    return {
      e: `Action ${v1} ${v2} with ${a} ${b} ${d} ${e}`,
    };
  });

// ----- Should not compile section ----

// @ts-expect-error - Should not compile without a statement
whenBuilder<SampleGivenState, SampleWhenState>().step(() => {
  return {
    a: "action",
  };
});

whenBuilder<SampleGivenState, SampleWhenState>()
  .statement(() => "When a user does something")
  // @ts-expect-error - Should not compile since no variables are declared
  .step(({ variables: [v1, v2] }) => {
    return {
      a: `Action ${v1} ${v2}`,
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
  .statement(
    (v1: string, v2: number, v3: boolean) =>
      `When a user does ${v1} ${v2} ${v3}`
  )
  // @ts-expect-error - Should not compile since the number of variables exceeds the number declared
  .step(({ variables: [v1, v2, v3, v4] }) => {
    return {
      a: `Action ${v1} ${v2} ${v3} ${v4}`,
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
    // @ts-expect-error - Should not compile since a is optional and can be undefined
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
