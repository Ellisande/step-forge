// Step definitions written in the pre-bound styles a consumer commonly uses.
// The direct `givenBuilder().statement(...)` chain is covered by steps.ts; this
// fixture exercises the re-exported forms the static extractor must also handle.
import { Given, When, Then } from "./prebound-builders";
import { createBuilders } from "../../../src/init";
import { intParser } from "../../../src/parsers";

type GivenState = { user: { name: string } };
type WhenState = { order: { id: string } };
type ThenState = Record<string, never>;

// Cross-file re-exported bound `.statement` (README "Simpler Step Definitions").
Given("a prebound customer").step(() => ({ user: { name: "x" } }));

When("I place a prebound order")
  .dependencies({ given: { user: "required" } })
  .step(() => ({ order: { id: "1" } }));

Then("the prebound order exists")
  .dependencies({ when: { order: "required" } })
  .step(() => {});

// Destructured `createBuilders()` builder object, with a variable placeholder.
const { When: Act } = createBuilders<GivenState, WhenState, ThenState>();
Act.variables({ amount: intParser })
  .statement(v => `I deposit ${v.amount} prebound`)
  .dependencies({ given: { user: "required" } })
  .step(() => ({ order: { id: "2" } }));
