/**
 * A Parser maps a step-expression placeholder to a typed value.
 *
 * `gherkin` is the placeholder used when the step is registered (e.g. `{int}`),
 * which drives how the matcher recognises the value in a Gherkin step. `parse`
 * then converts the *raw matched text* into the desired TypeScript type — the
 * parser owns coercion end to end, so `{string}` arrives quoted and it is the
 * parser's job to unquote it.
 */
export type Parser<T> = {
  parse: (value: string) => T;
  gherkin: string;
};

/** Matches a quoted string (`{string}`) and strips the surrounding quotes. */
export const stringParser: Parser<string> = {
  parse: value => {
    const match = /^"([\s\S]*)"$/.exec(value) ?? /^'([\s\S]*)'$/.exec(value);
    return match ? match[1].replace(/\\(["'])/g, "$1") : value;
  },
  gherkin: "{string}",
};

/** Matches an unquoted integer (`{int}`). */
export const intParser: Parser<number> = {
  parse: value => parseInt(value, 10),
  gherkin: "{int}",
};

/** Matches an unquoted floating point number (`{float}`). */
export const numberParser: Parser<number> = {
  parse: value => parseFloat(value),
  gherkin: "{float}",
};

/** Matches an unquoted `true`/`false` word (`{word}`) and parses it to a boolean. */
export const booleanParser: Parser<boolean> = {
  parse: value => value === "true",
  gherkin: "{word}",
};
