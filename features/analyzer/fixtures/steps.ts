import { givenBuilder } from "../../../src/given";
import { whenBuilder } from "../../../src/when";
import { thenBuilder } from "../../../src/then";
import { intParser, stringParser, Parser } from "../../../src/parsers";

type Color = "red" | "green" | "blue";

// A custom parser declared in this file: the extractor resolves its `{color}`
// placeholder from this declaration's `name` property.
const colorParser: Parser<Color, "color"> = {
  name: "color",
  regexp: /red|green|blue/,
  parse: raw => raw as Color,
};

type GivenState = {
  user: { type: string; token: string };
  account: { id: string };
  favoriteColor: Color;
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
  .variables({ name: stringParser })
  .statement(v => `a user named ${v.name}`)
  .step(({ variables: { name } }) => {
    return {
      user: { type: "person", token: name },
    };
  });

// --- Steps with non-string placeholders (extractor must resolve these) --- //

givenBuilder<GivenState>()
  .variables({ color: colorParser })
  .statement(v => `my favorite color is ${v.color}`)
  .step(({ variables: { color } }) => {
    return {
      favoriteColor: color,
    };
  });

whenBuilder<GivenState, WhenState>()
  .variables({ amount: intParser, currency: stringParser })
  .statement(v => `I deposit ${v.amount} ${v.currency}`)
  .dependencies({ given: { user: "required" } })
  .step(() => {
    return {
      result: { success: true },
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
  .variables({ name: stringParser })
  .statement(v => `the user's name is ${v.name}`)
  .dependencies({ when: { user: "required" } })
  .step(() => {});

thenBuilder<GivenState, WhenState, ThenState>()
  .statement("the account might exist")
  .dependencies({ given: { account: "optional" } })
  .step(() => {});
