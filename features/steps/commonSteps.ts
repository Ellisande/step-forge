import { givenBuilder } from "../../src/given";
import { whenBuilder } from "../../src/when";
import { thenBuilder } from "../../src/then";
import { intParser, stringParser, TableParser } from "../../src/parsers";
import { GivenState, ThenState, WhenState } from "./world";
import { expect } from "earl";

// A typed table parser: header row `| name | age |` over N body rows becomes a
// typed `{ name: string; age: number }[]`. The parser owns coercion, exactly
// like a scalar Parser<T>.
const usersTableParser: TableParser<GivenState["users"]> = {
  parse: ([, ...body]) =>
    body.map(([name, age]) => ({ name, age: parseInt(age, 10) })),
};

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

// --- Data table steps --- //

givenBuilder<GivenState>()
  .statement("the following users")
  .table(usersTableParser)
  .step(({ table }) => {
    // `table` is typed as GivenState["users"] — no `as`, no manual coercion.
    return { users: table };
  });

thenBuilder<GivenState, WhenState, ThenState>()
  .statement((count: number) => `there are ${count} users`)
  .parsers([intParser])
  .dependencies({ given: { users: "required" } })
  .step(({ variables: [count], given: { users } }) => {
    expect(users.length).toEqual(count);
    expect(users[0].age).toEqual(30);
    expect(typeof users[0].age).toEqual("number");
  });
