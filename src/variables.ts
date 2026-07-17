/* eslint-disable @typescript-eslint/no-explicit-any */
import { Parser } from "./parsers";

/**
 * Named-variable declarations for a step: each key is a variable name, each
 * value the parser that recognises and coerces it. Declared via the builder's
 * `.variables({...})` entry point, this map is the single source of truth for
 * a step's variables — their names, their order-independent identity, and
 * (through each parser's `parse` return type) their TypeScript types.
 */
export type VariableMap = Record<string, Parser<any>>;

declare const variableTokenBrand: unique symbol;

/**
 * Interpolation-only placeholder for a step variable: matches `{Name}` in the
 * step text and resolves to a `T` in the step function's `variables`.
 *
 * Handed to a named statement function, one per declared variable.
 * Interpolating it into the statement template
 * (`` v => `a user named ${v.userName}` ``) is its only legal use: at
 * registration time its `toString()` renders the parser's cucumber-expression
 * placeholder (`{string}`, `{int}`, `{color}`, …) and records the
 * interpolation order, which is how captured values are mapped back to
 * variable *names* at run time. The brand makes any other use — arithmetic,
 * string methods, comparisons — a type error. The `placeholder` property is a
 * type-level hint only (it does not exist at runtime): both type arguments are
 * visible on hover, so a statement author can see what the variable matches
 * and what their step will receive.
 */
export type Variable<T, Name extends string = string> = {
  /** The cucumber-expression placeholder this variable renders as. Type-level only. */
  readonly placeholder: `{${Name}}`;
  readonly [variableTokenBrand]: T;
};

/** The token object a named statement function receives: one token per declared variable. */
export type VariableTokens<Map extends VariableMap> = {
  readonly [K in keyof Map]: Map[K] extends Parser<infer T, infer Name>
    ? Variable<T, Name>
    : never;
};

/**
 * The named `variables` object a step function receives: each declared
 * variable, typed by its parser's `parse` return type.
 */
export type VariablesOf<Map extends VariableMap> = {
  [K in keyof Map]: Map[K] extends Parser<infer T> ? T : never;
};

/**
 * The `variables` type of a step whose statement declares none (a plain string
 * statement): an empty object, so any property access is a type error.
 */
export type NoVariables = Record<never, never>;

/**
 * Render a named statement into its cucumber expression. The statement is
 * called exactly once with a token per declared variable; each token's
 * `toString()` emits the parser's placeholder and appends the variable's name
 * to `order`, so the returned `order` is the positional layout of the
 * expression's capture groups. The runtime uses it to turn the matcher's
 * positional captures back into a named object.
 *
 * Validated eagerly (at registration, not at match time): every declared
 * variable must be interpolated exactly once, so the positional ↔ named
 * mapping is total and unambiguous.
 */
export const renderNamedExpression = (
  statement: (tokens: any) => string,
  variables: VariableMap
): { expression: string; order: string[] } => {
  const order: string[] = [];
  const tokens: Record<string, unknown> = {};
  for (const name of Object.keys(variables)) {
    tokens[name] = {
      toString: () => {
        order.push(name);
        return `{${variables[name].name}}`;
      },
    };
  }
  const expression = statement(tokens);
  const seen = new Set<string>();
  for (const name of order) {
    if (seen.has(name)) {
      throw new Error(
        `Variable "${name}" is interpolated more than once in statement "${expression}". ` +
          `Each declared variable must appear exactly once.`
      );
    }
    seen.add(name);
  }
  for (const name of Object.keys(variables)) {
    if (!seen.has(name)) {
      throw new Error(
        `Variable "${name}" is declared in .variables() but never interpolated ` +
          `in statement "${expression}".`
      );
    }
  }
  return { expression, order };
};
