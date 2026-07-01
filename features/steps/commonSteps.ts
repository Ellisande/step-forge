import { givenBuilder } from "../../src/given";
import { whenBuilder } from "../../src/when";
import { thenBuilder } from "../../src/then";
import { intParser, stringParser } from "../../src/parsers";
import { GivenState, ThenState, WhenState } from "./world";
import { expect } from "earl";

// --- No dependency no variable steps --- //
givenBuilder<GivenState>()
  .statement("I started")
  .step(() => ({}));

whenBuilder<GivenState, WhenState>()
  .statement("I got here")
  .step(() => ({}));

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("everything was good")
  .step(() => ({}));

// --- Dependency only steps --- //
givenBuilder<GivenState>()
  .statement("a user")
  .step(() => {
    return {
      user: {
        type: "person",
        token: "random",
      },
    };
  });

whenBuilder<GivenState, WhenState>()
  .statement("I save the user")
  .dependencies({ given: { user: "required" } })
  .step(({ given: { user } }) => {
    return {
      user: {
        ...user,
        saved: true,
      },
    };
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("there is a user")
  .dependencies({ when: { user: "required" } })
  .step(({ when: { user } }) => {
    expect(user.saved).toBeTruthy();
  });

// --- Variable only steps --- //
givenBuilder<GivenState>()
  .statement((userName: string) => `a user named ${userName}`)
  .step(({ variables: [userName] }) => {
    return {
      user: {
        type: "person",
        token: userName,
      },
    };
  });

// --- More complex steps --- //

whenBuilder<GivenState, WhenState>()
  .statement((userName: string) => `I name the user ${userName}`)
  .dependencies({ given: { user: "required" } })
  .step(({ given: { user }, variables: [userName] }) => {
    return {
      user: {
        ...user,
        token: userName,
        saved: true,
      },
    };
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((userName: string) => `the user's name is ${userName}`)
  .dependencies({ when: { user: "required" } })
  .step(({ when: { user }, variables: [userName] }) => {
    const token = user.token;
    expect(token).toEqual(userName);
  });

// --- Unquoted number variables (parsers) --- //

whenBuilder<GivenState, WhenState>()
  .statement(
    (amount: number, currency: string) => `I deposit ${amount} ${currency}`
  )
  .parsers([intParser, stringParser])
  .dependencies({ given: { user: "required" } })
  .step(({ variables: [amount, currency], given: { user } }) => {
    return {
      deposit: {
        amount,
        currency,
        user,
      },
    };
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((amount: number) => `the deposit amount is ${amount}`)
  .parsers([intParser])
  .dependencies({ when: { deposit: "required" } })
  .step(({ variables: [amount], when: { deposit } }) => {
    expect(deposit.amount).toEqual(amount);
    expect(typeof deposit.amount).toEqual("number");
  });
