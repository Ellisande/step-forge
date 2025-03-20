import { givenBuilder } from "../src/given";
import { stringParser } from "../src/parsers";
import { intParser } from "../src/parsers";
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

// Parsers example
givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number) => `Given a user ${v1} ${v2}`)
  .parsers([stringParser, intParser])
  .dependencies({ given: { a: "required", b: "optional", c: "required" } })
  .step(({ variables: [v1, v2], given: { a, b, c } }) => {
    return {
      b: `I love ${v1} ${v2} ${a} ${b} ${c}`,
    };
  });

// Dependencies are optional from parsers example
givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number) => `Given a user ${v1} ${v2}`)
  .parsers([stringParser, intParser])
  .step(({ variables: [v1, v2] }) => {
    return {
      b: `I love ${v1} ${v2}`,
    };
  });

// Without parsers all variables are strings in the step function
givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number) => `Given a user ${v1} ${v2}`)
  .step(({ variables: [v1, v2] }) => {
    const a: string = v1;
    const b: string = v2;
    return {
      b: `I love ${a} ${b}`,
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

givenBuilder<SampleGivenState>()
  .statement("Given a user")
  // @ts-expect-error - Should not compile since the return type is not a partial of given state
  .step(() => {
    return {
      f: "hello",
    };
  });

givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number, v3: boolean) => `Given a user ${v1} ${v2}`)
  // @ts-expect-error - Should not compile since the number of parsers does not match the number of variables
  .parsers([stringParser, intParser])
  .step(({ variables: [v1, v2] }) => {
    return {
      b: `I love ${v1} ${v2}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number) => `Given a user ${v1} ${v2}`)
  // @ts-expect-error - Should not compile there are more parsers than variables
  .parsers([stringParser, intParser, booleanParser])
  .step(({ variables: [v1, v2] }) => {
    return {
      b: `I love ${v1} ${v2}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number) => `Given a user ${v1} ${v2}`)
  // @ts-expect-error - Should not compile since the type of parsers does not match the arguments to statement
  .parsers([numberParser, intParser])
  .step(({ variables: [v1, v2] }) => {
    return {
      b: `I love ${v1} ${v2}`,
    };
  });

givenBuilder<SampleGivenState>()
  .statement((v1: string, v2: number) => `Given a user ${v1} ${v2}`)
  .step(({ variables: [v1, v2] }) => {
    const a: string = v1;
    // @ts-expect-error - Should not compile because without parsers all variables are strings
    const b: number = v2;
    return {
      b: `I love ${v1} ${v2}`,
    };
  });
