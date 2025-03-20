import { givenBuilder } from "../../src/given";
import { whenBuilder } from "../../src/when";
import { thenBuilder } from "../../src/then";
import { GivenState, ThenState, WhenState } from "./world";
import { expect } from "earl";
import { intParser, numberParser } from "../../src/parsers";
// --- No dependency no variable steps --- //
givenBuilder<GivenState>()
  .statement("I started")
  .step(() => ({}))
  .register();

whenBuilder<GivenState, WhenState>()
  .statement("I got here")
  .step(() => ({}))
  .register();

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("everything was good")
  .step(() => ({}))
  .register();

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
  })
  .register();

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
  })
  .register();

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("there is a user")
  .dependencies({ when: { user: "required" } })
  .step(({ when: { user } }) => {
    expect(user.saved).toBeTruthy();
  })
  .register();

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
  })
  .register();

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
  })
  .register();

whenBuilder<GivenState, WhenState>()
  .statement((age: number) => `I set the user's age to ${age}`)
  .parsers([intParser])
  .dependencies({ given: { user: "required" } })
  .step(({ given: { user }, variables: [age] }) => {
    return {
      user: {
        ...user,
        age,
        saved: true,
      },
    };
  })
  .register();

whenBuilder<GivenState, WhenState>()
  .statement((balance: number) => `I set the user's balance to ${balance}`)
  .parsers([numberParser])
  .dependencies({ given: { user: "required" } })
  .step(({ given: { user }, variables: [balance] }) => {
    return {
      user: {
        ...user,
        balance,
        saved: true,
      },
    };
  })
  .register();

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((userName: string) => `the user's name is ${userName}`)
  .dependencies({ when: { user: "required" } })
  .step(({ when: { user }, variables: [userName] }) => {
    const token = user.token;
    expect(token).toEqual(userName);
  })
  .register();

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((age: number) => `the user's age is ${age}`)
  .parsers([intParser])
  .dependencies({ when: { user: "required" } })
  .step(({ when: { user }, variables: [age] }) => {
    expect(user.age).toEqual(age);
  })
  .register();

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((balance: number) => `the user's balance is ${balance}`)
  .parsers([numberParser])
  .dependencies({ when: { user: "required" } })
  .step(({ when: { user }, variables: [balance] }) => {
    expect(user.balance).toEqual(balance);
  })
  .register();
