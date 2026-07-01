import { expect } from "earl";
import { givenBuilder } from "../../src/given";
import { thenBuilder } from "../../src/then";
import { whenBuilder } from "../../src/when";
import { intParser } from "../../src/parsers";
import { GivenState, ThenState, WhenState } from "./world";

// These steps build (but never register) other steps so we can inspect the
// Cucumber expression that Step Forge resolves from the statement + parsers.

thenBuilder<GivenState, WhenState, ThenState>()
  .statement(
    "a step with a variable and no parsers uses the string placeholder"
  )
  .step(() => {
    const built = givenBuilder<GivenState>()
      .statement((userName: string) => `a user named ${userName}`)
      .step(({ variables: [userName] }) => ({
        user: { type: "person", token: userName },
      }));
    expect(built.expression).toEqual("a user named {string}");
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("a step with an int parser uses the int placeholder")
  .step(() => {
    const built = whenBuilder<GivenState, WhenState>()
      .statement((amount: number) => `I deposit ${amount}`)
      .parsers([intParser])
      .step(({ variables: [amount] }) => ({
        deposit: {
          amount,
          currency: "USD",
          user: { type: "person", token: "random" },
        },
      }));
    expect(built.expression).toEqual("I deposit {int}");
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((value: string) => `an unparsed value of ${value} is a string`)
  .step(({ variables: [value] }) => {
    // No parsers declared, so the value is passed through unchanged rather
    // than being coerced to a number.
    expect(typeof value).toEqual("string");
    expect(value).toEqual("100");
  });
