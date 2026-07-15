import { describe, expect, it } from "bun:test";
import { findMatchingDefinitions } from "./stepMatcher";
import { StepDefinitionMeta } from "./types";

const def = (
  stepType: StepDefinitionMeta["stepType"],
  expression: string,
  parameters?: Record<string, string>
): StepDefinitionMeta => ({
  stepType,
  expression,
  dependencies: { given: {}, when: {}, then: {} },
  produces: [],
  sourceFile: "steps.ts",
  line: 1,
  ...(parameters ? { parameters } : {}),
});

describe("stepMatcher placeholder patterns", () => {
  const deposit = def("when", "I deposit {int} {string}");

  it("{int} matches integers only", () => {
    expect(
      findMatchingDefinitions('I deposit 100 "USD"', "When", [deposit])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions('I deposit -5 "USD"', "When", [deposit])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions('I deposit ten "USD"', "When", [deposit])
    ).toHaveLength(0);
    expect(
      findMatchingDefinitions('I deposit 1.5 "USD"', "When", [deposit])
    ).toHaveLength(0);
  });

  it("{string} requires a quoted value", () => {
    expect(
      findMatchingDefinitions("I deposit 100 USD", "When", [deposit])
    ).toHaveLength(0);
    expect(
      findMatchingDefinitions("I deposit 100 'USD'", "When", [deposit])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions('I deposit 100 "US \\"D\\""', "When", [deposit])
    ).toHaveLength(1);
  });

  it("{float} matches decimal numbers", () => {
    const price = def("then", "the price is {float}");
    expect(
      findMatchingDefinitions("the price is 19.99", "Then", [price])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions("the price is 19", "Then", [price])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions("the price is nineteen", "Then", [price])
    ).toHaveLength(0);
  });

  it("{boolean} matches true/false only", () => {
    const flag = def("then", "the flag is {boolean}");
    expect(
      findMatchingDefinitions("the flag is true", "Then", [flag])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions("the flag is false", "Then", [flag])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions("the flag is maybe", "Then", [flag])
    ).toHaveLength(0);
  });

  it("custom placeholders enforce their extracted pattern", () => {
    const color = def("given", "my favorite color is {color}", {
      color: "red|green|blue",
    });
    expect(
      findMatchingDefinitions("my favorite color is red", "Given", [color])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions("my favorite color is purple", "Given", [color])
    ).toHaveLength(0);
  });

  it("a custom placeholder without an extracted pattern matches any text", () => {
    const color = def("given", "my favorite color is {color}");
    expect(
      findMatchingDefinitions("my favorite color is purple", "Given", [color])
    ).toHaveLength(1);
  });

  it("matching is case-sensitive like the runtime engine", () => {
    const user = def("given", "a user");
    expect(findMatchingDefinitions("a user", "Given", [user])).toHaveLength(1);
    expect(findMatchingDefinitions("A User", "Given", [user])).toHaveLength(0);
  });

  it("cucumber optional text matches like the runtime engine", () => {
    const cukes = def("when", "I have {int} cucumber(s)");
    expect(
      findMatchingDefinitions("I have 1 cucumber", "When", [cukes])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions("I have 2 cucumbers", "When", [cukes])
    ).toHaveLength(1);
  });

  it("cucumber alternation matches like the runtime engine", () => {
    const errors = def("then", "there is/are {int} error/errors");
    expect(
      findMatchingDefinitions("there is 1 error", "Then", [errors])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions("there are 2 errors", "Then", [errors])
    ).toHaveLength(1);
    expect(
      findMatchingDefinitions("there was 1 error", "Then", [errors])
    ).toHaveLength(0);
  });
});
