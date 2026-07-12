/**
 * A Parser is a typed cucumber-expression *parameter type*: it declares how a
 * value is recognised in a Gherkin step (`regexp`) and how the matched text is
 * turned into a TypeScript value (`parse`). The step expression uses `{name}`
 * as the placeholder.
 *
 * The engine folds each parser straight into the cucumber-expression matcher —
 * `parse` is the parameter type's transform, so coercion happens exactly once,
 * during matching (no second pass). This is also what lets a parser introduce a
 * brand-new placeholder like `{color}`: it is registered as a real parameter
 * type, so text that doesn't match `regexp` simply doesn't match the step.
 *
 * The four built-ins below reuse cucumber-expressions' own built-in parameter
 * types (`{int}`, `{float}`, `{string}`) — those names are already registered,
 * so the library performs the match + coercion and each parser's `regexp`/
 * `parse` serve to document intent and to drive TypeScript inference of the
 * variable type. `booleanParser` has no built-in equivalent, so it is a genuine
 * custom parameter type whose `parse` runs at match time.
 */
export type Parser<T> = {
  /** Parameter-type name; the step expression uses `{name}` as the placeholder. */
  name: string;
  /** How cucumber-expressions recognises the value in the step text. */
  regexp: RegExp | RegExp[];
  /** Transform the matched text into the typed value. */
  parse: (value: string) => T;
};

/** Matches a quoted string (`{string}`) and strips the surrounding quotes. */
export const stringParser: Parser<string> = {
  name: "string",
  regexp: [/"([^"\\]*(\\.[^"\\]*)*)"/, /'([^'\\]*(\\.[^'\\]*)*)'/],
  parse: value => {
    const match = /^"([\s\S]*)"$/.exec(value) ?? /^'([\s\S]*)'$/.exec(value);
    return match ? match[1].replace(/\\(["'])/g, "$1") : value;
  },
};

/** Matches an unquoted integer (`{int}`). */
export const intParser: Parser<number> = {
  name: "int",
  regexp: /-?\d+/,
  parse: value => parseInt(value, 10),
};

/** Matches an unquoted floating point number (`{float}`). */
export const numberParser: Parser<number> = {
  name: "float",
  regexp: /-?\d*\.?\d+/,
  parse: value => parseFloat(value),
};

/**
 * Matches an unquoted `true`/`false` word (`{boolean}`) and parses it to a
 * boolean. Unlike the others this is a genuine custom parameter type — cucumber
 * has no built-in `boolean` — so its `regexp`/`parse` are what the matcher uses.
 */
export const booleanParser: Parser<boolean> = {
  name: "boolean",
  regexp: /true|false/,
  parse: value => value === "true",
};
