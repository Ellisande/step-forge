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

// ----- Should not compile section ----

// @ts-expect-error - Should not compile without a statement
givenBuilder<SampleGivenState>().step(() => {
  return {
    a: "user",
  };
});

// TODO: This should not compile, fix it later
// @ts-expect-error - Should not compile if the statement is a string and we attempt to access variables in the step
givenBuilder<SampleGivenState>()
  .statement("Given a user")
  .step(({ variables: [v1, v2] }) => {
    return {
      a: `I love ${v1} ${v2}`,
    };
  });
