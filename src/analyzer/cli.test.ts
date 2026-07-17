import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { StepCatalog } from "./catalog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliPath = path.join(repoRoot, "src/analyzer/cli.ts");
const fixturesDir = path.join(repoRoot, "features/analyzer/fixtures");
const fixtureStepFile = path.join(fixturesDir, "steps.ts");
const validFeature = path.join(fixturesDir, "valid-deps.feature");
const undefinedStepFeature = path.join(fixturesDir, "undefined-step.feature");

// A throwaway project directory whose step-forge.config.ts points at the
// analyzer fixtures, to exercise the CLI's config fallback.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-analyze-cli-"));
fs.writeFileSync(
  path.join(configDir, "step-forge.config.ts"),
  `export default {
  steps: ${JSON.stringify(fixtureStepFile)},
  features: ${JSON.stringify(validFeature)},
};
`
);

// A directory holding a differently-named symlink to the built bin, to
// reproduce how package managers expose it (node_modules/.bin/step-forge-analyze
// -> dist/analyzer-cli.js).
const binLinkDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-analyze-bin-"));
const builtBin = path.join(repoRoot, "build/dist/analyzer-cli.js");
const binSymlink = path.join(binLinkDir, "step-forge-analyze");
if (fs.existsSync(builtBin)) {
  fs.symlinkSync(builtBin, binSymlink);
}

afterAll(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.rmSync(binLinkDir, { recursive: true, force: true });
});

function runCli(cwd: string, ...args: string[]) {
  return Bun.spawnSync(["bun", cliPath, ...args], { cwd });
}

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

  it("falls back to step-forge.config.ts for step globs when --steps is omitted", () => {
    const result = Bun.spawnSync(["bun", cliPath, "catalog", "--json"], {
      cwd: configDir,
    });
    expect(result.exitCode).toBe(0);
    const catalog = JSON.parse(result.stdout.toString()) as StepCatalog;
    expect(catalog.steps.map(s => s.expression)).toContain(
      "I deposit {int} {string}"
    );
  });
});

describe("step-forge-analyze (diagnostics)", () => {
  it("reads step and feature globs from step-forge.config.ts when flags are omitted", () => {
    const result = runCli(configDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("No issues found.");
  });

  it("lets --features override the config file", () => {
    const result = runCli(configDir, "--features", undefinedStepFeature);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("undefined-step");
  });

  it("lets --steps override the config file", () => {
    // Point --steps at a step file that defines none of the feature's steps:
    // every step in the feature becomes an undefined-step error.
    const stepsWithoutMatches = path.join(
      repoRoot,
      "features/steps/analyzerSteps.ts"
    );
    const result = runCli(configDir, "--steps", stepsWithoutMatches);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain(
      "does not match any step definition"
    );
  });

  it("exits 1 when the resolved feature globs match nothing", () => {
    const result = runCli(configDir, "--features", "no/such/dir/**/*.feature");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("no feature files matched");
  });
});

// The bin is exposed by package managers as a differently-named symlink
// (node_modules/.bin/step-forge-analyze). Node does not resolve that symlink for
// process.argv[1], so the entry-point guard must compare *real* paths — an
// endsWith("analyzer-cli.js") check silently no-ops here. Requires a build;
// skipped when build/dist is absent (e.g. a bare `bun test src` with no build).
describe("step-forge-analyze bin entry point", () => {
  const maybeIt = fs.existsSync(builtBin) ? it : it.skip;

  maybeIt("runs when launched under node via a renamed bin symlink", () => {
    const result = Bun.spawnSync(
      ["node", binSymlink, "catalog", "--steps", fixtureStepFile, "--json"],
      { cwd: repoRoot }
    );
    expect(result.exitCode).toBe(0);
    const catalog = JSON.parse(result.stdout.toString()) as StepCatalog;
    expect(catalog.version).toBe(1);
    expect(catalog.steps.length).toBeGreaterThan(0);
  });
});
