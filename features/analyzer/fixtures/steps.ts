import { givenBuilder } from "../../../src/given";
import { whenBuilder } from "../../../src/when";
import { thenBuilder } from "../../../src/then";

type GivenState = {
  user: { type: string; token: string };
  account: { id: string };
};
type WhenState = {
  user: { type: string; token: string; saved: boolean };
  result: { success: boolean };
};
type ThenState = Record<string, never>;

// --- No dependency steps --- //

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
  .step(() => {})
  .register();

// --- Steps that produce state --- //

givenBuilder<GivenState>()
  .statement("a user")
  .step(() => {
    return {
      user: { type: "person", token: "abc" },
    };
  })
  .register();

givenBuilder<GivenState>()
  .statement((name: string) => `a user named ${name}`)
  .step(({ variables: [name] }) => {
    return {
      user: { type: "person", token: name },
    };
  })
  .register();

givenBuilder<GivenState>()
  .statement("an account")
  .step(() => {
    return {
      account: { id: "acct-1" },
    };
  })
  .register();

// --- Ambiguous steps (same expression, two definitions) --- //

givenBuilder<GivenState>()
  .statement("the system is ready")
  .step(() => ({}))
  .register();

givenBuilder<GivenState>()
  .statement("the system is ready")
  .step(() => ({}))
  .register();

// --- When steps with dependencies --- //

whenBuilder<GivenState, WhenState>()
  .statement("I save the user")
  .dependencies({ given: { user: "required" } })
  .step(({ given: { user } }) => {
    return {
      user: { ...user, saved: true },
    };
  })
  .register();

whenBuilder<GivenState, WhenState>()
  .statement("I delete the account")
  .dependencies({ given: { account: "required" } })
  .step(() => {
    return {
      result: { success: true },
    };
  })
  .register();

// --- Then steps with dependencies --- //

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("there is a user")
  .dependencies({ when: { user: "required" } })
  .step(() => {})
  .register();

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((name: string) => `the user's name is ${name}`)
  .dependencies({ when: { user: "required" } })
  .step(() => {})
  .register();

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("the account might exist")
  .dependencies({ given: { account: "optional" } })
  .step(() => {})
  .register();
