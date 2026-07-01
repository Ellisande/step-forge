import { givenBuilder } from "../../src/given";
import { whenBuilder } from "../../src/when";
import { thenBuilder } from "../../src/then";
import { intParser, stringParser } from "../../src/parsers";
import {
  beforeFeature,
  beforeScenario,
  afterScenario,
  beforeAll,
} from "../../src/hooks";
import { GivenState, ThenState, WhenState } from "./world";
import { expect } from "earl";

// --- Hooks (side-effect only; observed by the scenario below) --- //
let globalStarted = false;
let featureStarted = false;
let beforeScenarioRuns = 0;
let lastScenarioName = "";
// Global runs once per worker, in this same realm, so a module flag is visible
// to the step below.
beforeAll(() => {
  globalStarted = true;
});
beforeFeature(() => {
  featureStarted = true;
});
beforeScenario(({ scenario }) => {
  beforeScenarioRuns += 1;
  lastScenarioName = scenario.name;
});
afterScenario(() => {
  // Purely a smoke test that after-hooks run without a world contract.
});

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

// --- Hook observation step --- //

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((name: string) => `the hooks have run for scenario ${name}`)
  .step(({ variables: [name] }) => {
    expect(globalStarted).toEqual(true);
    expect(featureStarted).toEqual(true);
    expect(beforeScenarioRuns > 0).toEqual(true);
    expect(lastScenarioName).toEqual(name);
  });
