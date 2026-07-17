import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { StepCatalog } from "./catalog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliPath = path.join(repoRoot, "src/analyzer/cli.ts");
const fixtureStepFile = path.join(
  repoRoot,
  "features/analyzer/fixtures/steps.ts"
);

function runCatalogCli(...args: string[]) {
  return Bun.spawnSync(["bun", cliPath, "catalog", ...args], {
    cwd: repoRoot,
  });
}

describe("step-forge-analyze catalog", () => {
  it("emits the versioned JSON envelope", () => {
    const result = runCatalogCli("--steps", fixtureStepFile, "--json");
    expect(result.exitCode).toBe(0);
    const catalog = JSON.parse(result.stdout.toString()) as StepCatalog;
    expect(catalog.version).toBe(1);
    const deposit = catalog.steps.find(
      s => s.expression === "I deposit {int} {string}"
    );
    expect(deposit?.stepType).toBe("when");
    expect(deposit?.dependencies.given).toEqual({ user: "required" });
    expect(deposit?.produces).toEqual(["result"]);
    expect(deposit?.id).toBe(`${deposit?.sourceFile}:${deposit?.line}`);
  });

  it("applies filters before emitting JSON", () => {
    const result = runCatalogCli(
      "--steps",
      fixtureStepFile,
      "--consumes",
      "given.user",
      "--json"
    );
    expect(result.exitCode).toBe(0);
    const catalog = JSON.parse(result.stdout.toString()) as StepCatalog;
    expect(catalog.steps.map(s => s.expression).sort()).toEqual([
      "I deposit {int} {string}",
      "I save the user",
    ]);
  });

  it("exits 0 with an empty result when no steps match a filter", () => {
    const result = runCatalogCli(
      "--steps",
      fixtureStepFile,
      "--produces",
      "no-such-key",
      "--json"
    );
    expect(result.exitCode).toBe(0);
    const catalog = JSON.parse(result.stdout.toString()) as StepCatalog;
    expect(catalog.steps).toEqual([]);
  });

  it("exits 1 when no step files resolve", () => {
    const result = runCatalogCli("--steps", "no/such/dir/**/*.ts");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("no step files matched");
  });

  it("exits 1 on an invalid flag value", () => {
    const result = runCatalogCli("--steps", fixtureStepFile, "--type", "nope");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('Invalid --type "nope"');
  });
});
