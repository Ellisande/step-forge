import { createBuilders } from "../src/init";
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

Given("a user").step(() => {
  return {
    a: "user",
  };
});

When("a user does something")
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

Then("we should see something")
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
