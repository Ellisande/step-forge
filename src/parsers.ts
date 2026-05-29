/**
 * A Parser maps a Cucumber expression placeholder to a typed value.
 *
 * `gherkin` is the Cucumber Expression placeholder used when registering the
 * step (e.g. `{int}`). `parse` converts the raw value Cucumber captures into
 * the desired TypeScript type.
 *
 * Note: Cucumber Expressions already transform `{int}`/`{float}` captures into
 * JS numbers before the step function runs, so `parse` receives an `unknown`
 * and must tolerate both the pre-transformed value and a raw string.
 */
export type Parser<T> = {
  parse: (value: unknown) => T;
  gherkin: string;
};

/** Matches a quoted string (`{string}`) and passes the unquoted contents through. */
export const stringParser: Parser<string> = {
  parse: value => String(value),
  gherkin: "{string}",
};

/** Matches an unquoted integer (`{int}`). */
export const intParser: Parser<number> = {
  parse: value =>
    typeof value === "number" ? value : parseInt(String(value), 10),
  gherkin: "{int}",
};

/** Matches an unquoted floating point number (`{float}`). */
export const numberParser: Parser<number> = {
  parse: value =>
    typeof value === "number" ? value : parseFloat(String(value)),
  gherkin: "{float}",
};

/** Matches an unquoted `true`/`false` word (`{word}`) and parses it to a boolean. */
export const booleanParser: Parser<boolean> = {
  parse: value => value === true || value === "true",
  gherkin: "{word}",
};
