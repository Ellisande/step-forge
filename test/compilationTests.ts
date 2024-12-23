import {
  SampleGivenState,
  SampleThenState,
  SampleWhenState,
} from "./testUtils";
import { GivenBuilder, WhenBuilder, ThenBuilder } from "../src/newStepBuilders";

// Good examples start
GivenBuilder<SampleGivenState>()
  .statement("no variable step")
  .step(() => ({ a: "b" }));

WhenBuilder<SampleGivenState, SampleWhenState>()
  .statement("simple step with deps")
  .dependencies({ given: { a: "required" }, when: { f: "optional" } })
  .step(({ given: { a }, when: { f, d } }) => ({ c: `${a} ${f} ${d}` }));

ThenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement("simple step with deps")
  .dependencies({
    given: { a: "required" },
    when: { e: "optional" },
    then: { g: "required" },
  })
  .step(({ given: { a }, when: { e }, then: { g } }) => {
    if (a === "a") {
      throw new Error("a is a");
    }
    if (e === "e") {
      throw new Error("e is e");
    }
    if (g === 1) {
      throw new Error("g is g");
    }
    return {};
  });

GivenBuilder<SampleGivenState>()
  .statement(
    (variable1: string, variable2: number) =>
      `given step ${variable1} with ${variable2}`
  )
  .step(({ variables: [a, b] }) => ({ a, b }));

// Complex example
ThenBuilder<SampleGivenState, SampleWhenState, SampleThenState>()
  .statement(
    (lots: string, ofVariables: number) =>
      `then step ${lots} with ${ofVariables}`
  )
  .dependencies({
    given: {
      a: "required",
    },
    when: {
      d: "required",
    },
    then: {
      g: "required",
    },
  })
  .step(
    ({
      given: { a },
      when: { d },
      then: { g },
      variables: [lots, ofVariables],
    }) => {
      if (
        a === "a" &&
        d === 1 &&
        g === 1 &&
        lots === "lots" &&
        ofVariables === 1
      ) {
        throw new Error("a is a, b is 1, and c is c");
      }
      return {};
    }
  );
// Good examples end

// Bad examples start
GivenBuilder<{ a: string; b: number }>()
  .statement("no variable step")
  // @ts-expect-error - Since the statement passed into GivenBuilder is not a function, the type of `variables` should resolve to never
  .step(({ variables: [a, b] }) => ({ a: `${a} ${b}` }));

GivenBuilder<{ a: string; b: number }>()
  .statement("no variable step")
  // @ts-expect-error - This should fail to compile because the provided given state type of `{ a: string; b: number }` does not have the `d` property
  .dependencies({ given: { d: "required" } })
  .step(() => ({}));

GivenBuilder<{ a: string; b: number }>()
  .statement("no variable step")
  // @ts-expect-error - This should fail to compile because Given steps should not allow `when` dependencies to be specified
  .dependencies({ when: { d: "required" } })
  .step(() => ({}));

WhenBuilder<SampleGivenState, SampleWhenState>()
  .statement("no variable step")
  .dependencies({ when: { d: "required" } })
  // @ts-expect-error - This should fail to compile because it attempts to access the `a` property of given state without a declared dependency
  .step(({ given: { a } }) => ({ a }));

WhenBuilder<SampleGivenState, SampleWhenState>()
  .statement("no variable step")
  // @ts-expect-error - This should fail to compile because it attempts to set the `r` in when state, but it when state doesn't have the `r` property
  .step(() => ({ r: a }));
// Bad examples end
