import { createBuilders } from "../src/init";
import { intParser } from "../src/parsers";
import {
  SampleGivenState,
  SampleWhenState,
  SampleThenState,
} from "./testUtils";

// --- Build Helpers section ---

const { Given, When, Then } = createBuilders<
  SampleGivenState,
  SampleWhenState,
  SampleThenState
>();

Given.statement("a user").step(() => {
  return {
    a: "user",
  };
});

When.statement("a user does something")
  .dependencies({
    given: {
      a: "required",
    },
  })
  .step(({ given }) => {
    return {
      e: `I love ${given.a}`,
    };
  });

Then.statement("we should see something")
  .dependencies({
    when: {
      d: "required",
    },
  })
  .step(({ when }) => {
    return {
      g: Number(when.d),
    };
  });

// The pre-bound builders also carry the named-variable entry point
When.variables({ count: intParser })
  .statement(v => `a user does something ${v.count} times`)
  .dependencies({
    given: {
      a: "required",
    },
  })
  .step(({ variables: { count }, given }) => {
    return {
      e: `${given.a} happened ${count} times`,
    };
  });
