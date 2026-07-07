import { test, expect } from "bun:test";
import { findMatchingDefinitions } from "./stepMatcher";
import type { StepDefinitionMeta } from "./types";

/**
 * Regression tests for the analyzer's step matcher. It once compiled each
 * cucumber expression into a hand-rolled regex that treated alternative (`a/b`)
 * and optional (`text(s)`) syntax as literal text, so any step using them was
 * reported as undefined even though it ran fine. The matcher now uses the real
 * `@cucumber/cucumber-expressions` engine, matching the runtime.
 */

function def(
  expression: string,
  stepType: StepDefinitionMeta["stepType"] = "then",
  line = 1
): StepDefinitionMeta {
  return {
    stepType,
    expression,
    dependencies: { given: {}, when: {}, then: {} },
    produces: [],
    sourceFile: "steps.ts",
    line,
  };
}

test("matches an {int} value that is unquoted", () => {
  const defs = [def("the deposit amount is {int}")];
  expect(
    findMatchingDefinitions("the deposit amount is 100", "Then", defs)
  ).toHaveLength(1);
});

test("honours alternative syntax (error/errors)", () => {
  const defs = [def("there should be {int} error/errors")];
  expect(
    findMatchingDefinitions("there should be 1 error", "Then", defs)
  ).toHaveLength(1);
  expect(
    findMatchingDefinitions("there should be 2 errors", "Then", defs)
  ).toHaveLength(1);
});

test("honours optional syntax (text(s))", () => {
  const defs = [def("there is/are {int} error(s)")];
  expect(
    findMatchingDefinitions("there is 1 error", "Then", defs)
  ).toHaveLength(1);
  expect(
    findMatchingDefinitions("there are 3 errors", "Then", defs)
  ).toHaveLength(1);
});

test("a custom placeholder matches any value", () => {
  const defs = [def("my favorite color is {color}", "given")];
  expect(
    findMatchingDefinitions("my favorite color is green", "Given", defs)
  ).toHaveLength(1);
});

test("a literal step is not falsely ambiguous with an {int} step", () => {
  // `{int}` is strict, so `no` isn't an int — the literal is the only match,
  // exactly as the runtime resolves it. (This regressed when params were made
  // uniformly permissive.)
  const defs = [
    def("there should be no errors", "then", 1),
    def("there should be {int} error/errors", "then", 2),
  ];
  const matches = findMatchingDefinitions(
    "there should be no errors",
    "Then",
    defs
  );
  expect(matches).toHaveLength(1);
  expect(matches[0].line).toBe(1);
});

test("a genuinely undefined step matches nothing", () => {
  const defs = [def("a user named {string}", "given")];
  expect(
    findMatchingDefinitions("something entirely different", "Given", defs)
  ).toHaveLength(0);
});
