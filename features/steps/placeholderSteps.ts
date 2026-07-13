import { expect } from "earl";
import { givenBuilder } from "../../src/given";
import { thenBuilder } from "../../src/then";
import { whenBuilder } from "../../src/when";
import { intParser, stringParser } from "../../src/parsers";
import { GivenState, ThenState, WhenState } from "./world";

// These steps build (and, as a side effect of `.step()`, register) other steps
// so we can inspect the Cucumber expression that Step Forge resolves from the
// variables map + statement.

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("a step with a string variable uses the string placeholder")
  .step(() => {
    const built = givenBuilder<GivenState>()
      .variables({ userName: stringParser })
      .statement(v => `a user named ${v.userName}`)
      .step(({ variables: { userName } }) => ({
        user: { type: "person", token: userName },
      }));
    // `expression` is literal-typed from the statement: the annotation is
    // checked at compile time, the assertion at run time.
    const expression: `a user named ${string}` = built.expression;
    expect(expression).toEqual("a user named {string}");
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("a step with an int parser uses the int placeholder")
  .step(() => {
    const built = whenBuilder<GivenState, WhenState>()
      .variables({ amount: intParser })
      .statement(v => `I deposit ${v.amount}`)
      .step(({ variables: { amount } }) => ({
        deposit: {
          amount,
          currency: "USD",
          user: { type: "person", token: "random" },
        },
      }));
    const expression: `I deposit ${string}` = built.expression;
    expect(expression).toEqual("I deposit {int}");
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .variables({ value: stringParser })
  .statement(v => `a string-parsed value of ${v.value} is a string`)
  .step(({ variables: { value } }) => {
    // The string parser passes the (unquoted) value through unchanged rather
    // than coercing it to a number.
    expect(typeof value).toEqual("string");
    expect(value).toEqual("100");
  });
