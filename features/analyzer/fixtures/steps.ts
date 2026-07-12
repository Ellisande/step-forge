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
  .step(() => ({}));

whenBuilder<GivenState, WhenState>()
  .statement("I got here")
  .step(() => ({}));

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("everything was good")
  .step(() => {});

// --- Steps that produce state --- //

givenBuilder<GivenState>()
  .statement("a user")
  .step(() => {
    return {
      user: { type: "person", token: "abc" },
    };
  });

givenBuilder<GivenState>()
  .statement((name: string) => `a user named ${name}`)
  .step(({ variables: [name] }) => {
    return {
      user: { type: "person", token: name },
    };
  });

givenBuilder<GivenState>()
  .statement("an account")
  .step(() => {
    return {
      account: { id: "acct-1" },
    };
  });

// --- Ambiguous steps (same expression, two definitions) --- //

givenBuilder<GivenState>()
  .statement("the system is ready")
  .step(() => ({}));

givenBuilder<GivenState>()
  .statement("the system is ready")
  .step(() => ({}));

// --- When steps with dependencies --- //

whenBuilder<GivenState, WhenState>()
  .statement("I save the user")
  .dependencies({ given: { user: "required" } })
  .step(({ given: { user } }) => {
    return {
      user: { ...user, saved: true },
    };
  });

whenBuilder<GivenState, WhenState>()
  .statement("I delete the account")
  .dependencies({ given: { account: "required" } })
  .step(() => {
    return {
      result: { success: true },
    };
  });

// --- Then steps with dependencies --- //

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("there is a user")
  .dependencies({ when: { user: "required" } })
  .step(() => {});

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((name: string) => `the user's name is ${name}`)
  .dependencies({ when: { user: "required" } })
  .step(() => {});

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("the account might exist")
  .dependencies({ given: { account: "optional" } })
  .step(() => {});
