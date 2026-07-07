import { test, expect, afterAll } from "bun:test";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractStepDefinitions } from "./stepExtractor";

/**
 * The extractor derives each variable's cucumber placeholder from the step's
 * `.parsers([...])`. It used to hardcode `{string}` for every variable, so a
 * `{int}` or custom `{color}` step was recorded as `{string}` and later looked
 * unmatched against a plain (unquoted) value. Built-in parsers map by identifier;
 * a custom parser is resolved from its in-file `name` property.
 */

const fixture = join(tmpdir(), `sf-extractor-${process.pid}.steps.ts`);
writeFileSync(
  fixture,
  `import { givenBuilder, whenBuilder } from "x";
const colorParser = { name: "color", regexp: /red|green/, parse: (v: string) => v };

whenBuilder()
  .statement((amount: number, currency: string) => \`I deposit \${amount} \${currency}\`)
  .parsers([intParser, stringParser])
  .step(() => ({}));

givenBuilder()
  .statement((color: string) => \`my favorite color is \${color}\`)
  .parsers([colorParser])
  .step(() => ({}));

givenBuilder()
  .statement((name: string) => \`a user named \${name}\`)
  .step(() => ({}));
`
);
afterAll(() => rmSync(fixture, { force: true }));

test("derives placeholders from .parsers (built-in + custom)", () => {
  const defs = extractStepDefinitions([fixture]);
  const byText = (needle: string) =>
    defs.find(d => d.expression.includes(needle))?.expression;

  expect(byText("deposit")).toBe("I deposit {int} {string}");
  expect(byText("favorite color")).toBe("my favorite color is {color}");
  // No `.parsers(...)` → the variable falls back to the default {string}.
  expect(byText("a user named")).toBe("a user named {string}");
});
