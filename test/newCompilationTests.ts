import { givenBuilder } from "../src/newStepBuilders";
import { SampleGivenState } from "./testUtils";

// Simplest possible example
givenBuilder<SampleGivenState>()
  .statement("Given a user")
  .step(() => {
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

// Simple variables example
givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number) => `Given a user ${v1} ${v2}`)
  .step(({ variables: [v1, v2] }) => {
    return {
      b: `I love ${v1} ${v2}`,
    };
  });

// Complex example
givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number) => `Given a user ${v1} ${v2}`)
  .dependencies({
    given: {
      a: "required",
      b: "optional",
      c: "required",
    },
  })
  .step(({ variables: [v1, v2], given: { a, b, c } }) => {
    return {
      b: `I love ${v1} ${v2} ${a} ${b} ${c}`,
    };
  });

// ----- Should not compile section ----

// @ts-expect-error - Should not compile without a statement
givenBuilder<SampleGivenState>().step(() => {
  return {
    a: "user",
  };
});

givenBuilder<SampleGivenState>()
  .statement(() => "Given a user")
  // @ts-expect-error - Should not compile since no variables are declared
  .step(({ variables: [v1, v2] }) => {
    return {
      a: `I love ${v1} ${v2}`,
    };
  });

// TODO: Currently resolves variables to `any[]` which is incorrect
givenBuilder<SampleGivenState>()
  .statement("Given a user")
  // @ts-expect-error - Should not compile since no variables are declared
  .step(({ variables: [v1, v2] }) => {
    return {
      a: `I love ${v1} ${v2}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement(
    (v1: string, v2: number, v3: boolean) => `Given a user ${v1} ${v2} ${v3}`
  )
  // @ts-expect-error - Should not compile since the number of variables exceeds the number declared
  .step(({ variables: [v1, v2, v3, v4] }) => {
    return {
      a: `I love ${v1} ${v2} ${v3} ${v4}`,
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
