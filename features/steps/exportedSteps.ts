import { expect } from "earl";
import { createBuilders } from "../../src/init";
import { numberParser, stringParser } from "../../src/parsers";
import { GivenState, ThenState, WhenState } from "./world";

// Demo of the pre-bound builder style: `Given("...")` for plain statements,
// `Given.variables({...}).statement(v => ...)` for statements with variables.
const { Given, When, Then } = createBuilders<
  GivenState,
  WhenState,
  ThenState
>();

Given("a bank user").step(() => {
  return {
    user: {
      type: "customer",
      token: "random",
    },
  };
});

When.variables({ amount: numberParser, currency: stringParser })
  .statement(v => `I deposit ${v.amount} ${v.currency}`)
  .dependencies({ given: { user: "required" } })
  .step(({ variables: { amount, currency }, given: { user } }) => {
    return {
      deposit: {
        amount,
        currency,
        user,
      },
    };
  });

Then.variables({ amount: numberParser })
  .statement(v => `the balance is ${v.amount}`)
  .dependencies({ when: { deposit: "required" } })
  .step(({ when: { deposit }, variables: { amount } }) => {
    expect(deposit.amount).toEqual(amount);
  });
