import { describe, expect, it } from "bun:test";
import { intParser, stringParser } from "./parsers";
import { renderNamedExpression, VariableTokens } from "./variables";

describe("renderNamedExpression", () => {
  it("renders each parser's placeholder and records interpolation order", () => {
    const { expression, order } = renderNamedExpression(
      (v: VariableTokens<{ amount: typeof intParser }>) =>
        `I deposit ${v.amount}`,
      { amount: intParser }
    );
    expect(expression).toBe("I deposit {int}");
    expect(order).toEqual(["amount"]);
  });

  it("orders by interpolation position, not declaration order", () => {
    const { expression, order } = renderNamedExpression(
      (v: Record<string, unknown>) => `pay ${v.currency} ${v.amount}`,
      { amount: intParser, currency: stringParser }
    );
    expect(expression).toBe("pay {string} {int}");
    expect(order).toEqual(["currency", "amount"]);
  });

  it("handles statements with no variables", () => {
    const { expression, order } = renderNamedExpression(() => "I started", {});
    expect(expression).toBe("I started");
    expect(order).toEqual([]);
  });

  it("throws when a declared variable is never interpolated", () => {
    expect(() =>
      renderNamedExpression(() => "I started", { amount: intParser })
    ).toThrow(/"amount" is declared .* never interpolated/);
  });

  it("throws when a variable is interpolated more than once", () => {
    expect(() =>
      renderNamedExpression(
        (v: Record<string, unknown>) => `between ${v.amount} and ${v.amount}`,
        { amount: intParser }
      )
    ).toThrow(/"amount" is interpolated more than once/);
  });
});
