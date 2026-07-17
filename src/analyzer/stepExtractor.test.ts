import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { extractStepDefinitions } from "./stepExtractor";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureStepFile = path.resolve(
  __dirname,
  "../../features/analyzer/fixtures/steps.ts"
);

describe("extractStepDefinitions", () => {
  const definitions = extractStepDefinitions([fixtureStepFile]);
  const expressions = definitions.map(d => d.expression);

  it("extracts plain string statements verbatim", () => {
    expect(expressions).toContain("I started");
    expect(expressions).toContain("a user");
  });

  it("extracts a string variable as {string}", () => {
    expect(expressions).toContain("a user named {string}");
    expect(expressions).toContain("the user's name is {string}");
  });

  it("extracts non-string builtin parsers with their exact placeholders", () => {
    // Previously every hole was hardcoded to {string}; the variables map must
    // now drive the placeholder per hole, in interpolation order.
    expect(expressions).toContain("I deposit {int} {string}");
  });

  it("resolves a same-file custom parser's placeholder from its declaration", () => {
    expect(expressions).toContain("my favorite color is {color}");
  });

  it("keeps step types and dependencies intact through the variables chain", () => {
    const deposit = definitions.find(
      d => d.expression === "I deposit {int} {string}"
    );
    expect(deposit?.stepType).toBe("when");
    expect(deposit?.dependencies.given).toEqual({ user: "required" });
  });

  it("infers produced keys from the step function's return value", () => {
    const save = definitions.find(d => d.expression === "I save the user");
    expect(save?.produces).toEqual(["user"]);
    const noop = definitions.find(d => d.expression === "everything was good");
    expect(noop?.produces).toEqual([]);
  });

  it("extracts a custom parser's regex pattern for the matcher", () => {
    const color = definitions.find(
      d => d.expression === "my favorite color is {color}"
    );
    expect(color?.parameters).toEqual({ color: "red|green|blue" });
  });

  it("emits no parameters for steps using only builtin parsers", () => {
    const deposit = definitions.find(
      d => d.expression === "I deposit {int} {string}"
    );
    expect(deposit?.parameters).toBeUndefined();
  });
});
