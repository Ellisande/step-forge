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

/**
 * A TableParser turns a Gherkin data table into a typed value. Unlike
 * `Parser<T>`, there is no `gherkin` placeholder: a data table is attached to a
 * step, not matched by the step expression. `parse` receives the raw rows —
 * every cell as its raw string, the header row included — and owns coercion end
 * to end, exactly like `Parser<T>` does for scalars.
 */
export type TableParser<T> = {
  parse: (rows: string[][]) => T;
};

/** Passes the raw rows straight through, header row included. */
export const rawTableParser: TableParser<string[][]> = {
  parse: rows => rows,
};

/**
 * Treats the first row as headers and maps each remaining row to an object
 * keyed by header. A table with header `| name | age |` over two body rows
 * yields `[{ name, age }, { name, age }]`. Values stay strings — compose a
 * typed `TableParser<T>` if you need coercion.
 */
export const recordsTableParser: TableParser<Record<string, string>[]> = {
  parse: ([header = [], ...body]) =>
    body.map(row =>
      Object.fromEntries(header.map((key, index) => [key, row[index]]))
    ),
};
