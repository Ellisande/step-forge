import { givenBuilder } from "../../src/given";
import { whenBuilder } from "../../src/when";
import { thenBuilder } from "../../src/then";
import { intParser, stringParser, Parser } from "../../src/parsers";
import {
  beforeFeature,
  beforeScenario,
  afterScenario,
  beforeAll,
} from "../../src/hooks";
import { Color, GivenState, ThenState, WhenState } from "./world";
import { expect } from "earl";

// A custom parser introducing a brand-new `{color}` placeholder: only
// `red|green|blue` match, so anything else is an undefined step at match time.
// The literal `"color"` name type makes named-variable hovers show
// `Variable<Color, "color">` instead of `Variable<Color, string>`.
const colorParser: Parser<Color, "color"> = {
  name: "color",
  regexp: /red|green|blue/,
  parse: raw => raw as Color,
};

// --- Hooks (side-effect only; observed by the scenario below) --- //
//
// These module flags are write-once (globalStarted/featureStarted) or monotonic
// (beforeScenarioRuns), so they're safe to read from any scenario even under
// concurrent execution. We deliberately do NOT record per-scenario identity
// (e.g. "the last scenario name") here: a hook seeding mutable state that a step
// reads back is a cross-scenario data race and violates the framework's
// contract that scenario state flows only through the isolated world. That
// hook-plumbing check lives in a runtime unit test instead (hooks.test.ts).
let globalStarted = false;
let featureStarted = false;
let beforeScenarioRuns = 0;
// Global runs once per worker, in this same realm, so a module flag is visible
// to the step below.
beforeAll(() => {
  globalStarted = true;
});
beforeFeature(() => {
  featureStarted = true;
});
beforeScenario(() => {
  beforeScenarioRuns += 1;
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
  .variables({ userName: stringParser })
  .statement(v => `a user named ${v.userName}`)
  .step(({ variables: { userName } }) => {
    return {
      user: {
        type: "person",
        token: userName,
      },
    };
  });

// --- More complex steps --- //

whenBuilder<GivenState, WhenState>()
  .variables({ userName: stringParser })
  .statement(v => `I name the user ${v.userName}`)
  .dependencies({ given: { user: "required" } })
  .step(({ given: { user }, variables: { userName } }) => {
    return {
      user: {
        ...user,
        token: userName,
        saved: true,
      },
    };
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .variables({ userName: stringParser })
  .statement(v => `the user's name is ${v.userName}`)
  .dependencies({ when: { user: "required" } })
  .step(({ when: { user }, variables: { userName } }) => {
    const token = user.token;
    expect(token).toEqual(userName);
  });

// --- Unquoted number variables (parsers) --- //

whenBuilder<GivenState, WhenState>()
  .variables({ amount: intParser, currency: stringParser })
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

thenBuilder<GivenState, WhenState, ThenState>()
  .variables({ amount: intParser })
  .statement(v => `the deposit amount is ${v.amount}`)
  .dependencies({ when: { deposit: "required" } })
  .step(({ variables: { amount }, when: { deposit } }) => {
    expect(deposit.amount).toEqual(amount);
    expect(typeof deposit.amount).toEqual("number");
  });

// --- Custom parser (novel {color} placeholder) --- //

givenBuilder<GivenState>()
  .variables({ color: colorParser })
  .statement(v => `my favorite color is ${v.color}`)
  .step(({ variables: { color } }) => ({ favoriteColor: color }));

thenBuilder<GivenState, WhenState, ThenState>()
  .variables({ color: colorParser })
  .statement(v => `the favorite color is ${v.color}`)
  .dependencies({ given: { favoriteColor: "required" } })
  .step(({ variables: { color }, given: { favoriteColor } }) => {
    expect(favoriteColor).toEqual(color);
  });

// --- Declaration order vs interpolation order --- //

givenBuilder<GivenState>()
  .variables({ userName: stringParser })
  .statement(v => `a registered user named ${v.userName}`)
  .step(({ variables: { userName } }) => ({
    user: {
      type: "person",
      token: userName,
    },
  }));

// Interpolation order (currency before amount) deliberately differs from the
// declaration order — the runtime maps captures by interpolation, not by key.
whenBuilder<GivenState, WhenState>()
  .variables({ amount: intParser, currency: stringParser })
  .statement(v => `I transfer ${v.currency} in the amount of ${v.amount}`)
  .dependencies({ given: { user: "required" } })
  .step(({ variables: { amount, currency }, given: { user } }) => ({
    deposit: {
      amount,
      currency,
      user,
    },
  }));

thenBuilder<GivenState, WhenState, ThenState>()
  .variables({ amount: intParser, currency: stringParser })
  .statement(v => `the transfer was ${v.amount} ${v.currency}`)
  .dependencies({ when: { deposit: "required" } })
  .step(({ variables: { amount, currency }, when: { deposit } }) => {
    expect(deposit.amount).toEqual(amount);
    expect(typeof amount).toEqual("number");
    expect(deposit.currency).toEqual(currency);
  });

// --- Hook observation step --- //

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("the hooks have run")
  .step(() => {
    expect(globalStarted).toEqual(true);
    expect(featureStarted).toEqual(true);
    expect(beforeScenarioRuns > 0).toEqual(true);
  });
