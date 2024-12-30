import { expect } from "earl";
import { givenBuilder } from "../../src/given";
import { thenBuilder } from "../../src/then";
import { whenBuilder } from "../../src/when";
import { GivenState, ThenState, WhenState } from "./world";

const Given = givenBuilder<GivenState>().statement;
const When = whenBuilder<GivenState, WhenState>().statement;
const Then = thenBuilder<GivenState, WhenState, ThenState>().statement;

Given("a bank user")
  .step(() => {
    return {
      user: {
        type: "customer",
        token: "random",
      },
    };
  })
  .register();

When((amount: string, currency: string) => `I deposit ${amount} ${currency}`)
  .dependencies({ given: { user: "required" } })
  .step(({ variables: [rawAmount, currency], given: { user } }) => {
    const amount = parseFloat(rawAmount);
    return {
      deposit: {
        amount,
        currency,
        user,
      },
    };
  })
  .register();

Then((amount: string) => `the balance is ${amount}`)
  .dependencies({ when: { deposit: "required" } })
  .step(({ when: { deposit }, variables: [rawAmount] }) => {
    const amount = parseFloat(rawAmount);
    expect(deposit.amount).toEqual(amount);
  })
  .register();
