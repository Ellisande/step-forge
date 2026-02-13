import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "earl";
import { analyze, Diagnostic } from "../../src/analyzer/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../analyzer/fixtures");

let fixtureStepFile: string;
let fixtureFeatureFile: string;
let diagnostics: Diagnostic[];

Given("step definitions from {string}", function (fileName: string) {
  fixtureStepFile = path.join(fixturesDir, fileName);
});

Given("a feature file {string}", function (fileName: string) {
  fixtureFeatureFile = path.join(fixturesDir, fileName);
});

When("I analyze the files", async function () {
  diagnostics = await analyze({
    stepFiles: [fixtureStepFile],
    featureFiles: [fixtureFeatureFile],
  });
});

Then("there should be no errors", function () {
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toHaveLength(0);
});

Then("there should be {int} error/errors", function (count: number) {
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toHaveLength(count);
});

Then("an error should mention {string}", function (substring: string) {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const found = errors.some((e) => e.message.includes(substring));
  expect(found).toEqual(true);
});

Then(
  "there is/are {int} error/errors for rule {string}",
  function (count: number, rule: string) {
    const errors = diagnostics.filter(
      (d) => d.severity === "error" && d.rule === rule
    );
    expect(errors).toHaveLength(count);
  }
);
