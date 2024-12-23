import { thenBuilder } from "../src/then";
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

// Simple variables example
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement((v1: string, v2: number) => `Then we should see ${v1} ${v2} times`)
  .step(({ variables: [v1, v2] }) => {
    return {
      i: { j: `Result ${v1} ${v2}` },
    };
  });

// Complex example with all dependencies
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement((v1: string, v2: number) => `Then we should see ${v1} ${v2} times`)
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
      variables: [v1, v2],
      given: { a, b },
      when: { d, e },
      then: { g, h },
    }) => {
      return {
        i: { j: `Result ${v1} ${v2} with ${a} ${b} ${d} ${e} ${g} ${h}` },
      };
    }
  );

// ----- Should not compile section ----

// @ts-expect-error - Should not compile without a statement
thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>().step(() => {
  return {
    i: { j: "result" },
  };
});

thenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement(() => "Then we should see something")
  // @ts-expect-error - Should not compile since no variables are declared
  .step(({ variables: [v1, v2] }) => {
    return {
      i: { j: `Result ${v1} ${v2}` },
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
  .statement(
    (v1: string, v2: number, v3: boolean) =>
      `Then we should see ${v1} ${v2} ${v3}`
  )
  // @ts-expect-error - Should not compile since the number of variables exceeds the number declared
  .step(({ variables: [v1, v2, v3, v4] }) => {
    return {
      i: { j: `Result ${v1} ${v2} ${v3} ${v4}` },
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
