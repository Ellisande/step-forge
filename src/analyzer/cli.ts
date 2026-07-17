#!/usr/bin/env node

import { realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./index.js";
import { globFiles } from "../globFiles.js";
import { buildCatalog, filterCatalog } from "./catalog.js";
import type { CatalogEntry, CatalogQuery, Phase } from "./catalog.js";
import { loadConfigFile, resolveConfig } from "../runtime/config.js";
import type { AnalyzerConfig, Diagnostic } from "./types.js";

function parseArgs(args: string[]): AnalyzerConfig {
  const config: AnalyzerConfig = {
    stepFiles: [],
    featureFiles: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if ((arg === "--steps" || arg === "-s") && next) {
      config.stepFiles.push(next);
      i++;
    } else if ((arg === "--features" || arg === "-f") && next) {
      config.featureFiles.push(next);
      i++;
    } else if (arg === "--tsconfig" && next) {
      config.tsConfigPath = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return config;
}

function printUsage() {
  console.log(`Usage: step-forge-analyze [options]
       step-forge-analyze catalog [options]

Options:
  -s, --steps <glob>      Glob pattern for step definition files (repeatable).
                          Overrides the "steps" globs from step-forge.config.ts.
  -f, --features <glob>   Glob pattern for feature files (repeatable).
                          Overrides the "features" globs from step-forge.config.ts.
  --tsconfig <path>       Path to tsconfig.json (default: auto-detect)
  -h, --help              Show this help message

When a flag is omitted, the corresponding globs are read from
step-forge.config.ts in the current directory (falling back to the runner
defaults "**/*.steps.ts" / "**/*.feature").

The "catalog" subcommand lists implemented step definitions instead of
analyzing features; run "step-forge-analyze catalog --help" for its options.

Example:
  step-forge-analyze --steps "features/steps/**/*.ts" --features "features/**/*.feature"
`);
}

/**
 * Resolve step/feature globs with the same precedence as the runner:
 * CLI flags win; otherwise the globs come from step-forge.config.ts in the
 * current directory, then the runner defaults.
 */
async function resolveGlobs(cli: { steps?: string[]; features?: string[] }) {
  const cwd = process.cwd();
  const resolved = resolveConfig(cwd, await loadConfigFile(cwd), {
    steps: cli.steps?.length ? cli.steps : undefined,
    features: cli.features?.length ? cli.features : undefined,
  });
  return { steps: resolved.steps, features: resolved.features };
}

function printCatalogUsage() {
  console.log(`Usage: step-forge-analyze catalog [options]

Lists implemented step definitions (statically extracted; no code is run).

Options:
  -s, --steps <glob>      Glob pattern for step definition files (repeatable).
                          If omitted, step globs are read from step-forge.config.ts
                          (falling back to "**/*.steps.ts").
  --tsconfig <path>       Path to tsconfig.json (default: auto-detect)
  --json                  Emit the versioned JSON envelope { version, steps }
  --type <phase>          Filter by step type: given, when, or then
  --text <substring>      Filter by expression text (case-insensitive substring)
  --consumes <spec>       Filter by consumed state key. Spec forms:
                          "user" (any phase), "given.user" (phase-qualified),
                          with an optional ":required" / ":optional" suffix
  --produces <key>        Filter by produced state key (exact match)
  --source <substring>    Filter by source file path (case-insensitive substring)
  -h, --help              Show this help message

Examples:
  step-forge-analyze catalog --json
  step-forge-analyze catalog --consumes given.user:required --type when
`);
}

function formatDiagnostic(diag: Diagnostic): string {
  const location = `${diag.file}:${diag.range.startLine}:${diag.range.startColumn}`;
  return `${location} - ${diag.severity}: ${diag.message}`;
}

const PHASES: Phase[] = ["given", "when", "then"];

function isPhase(value: string): value is Phase {
  return (PHASES as string[]).includes(value);
}

/** Parse a `--consumes` spec: `key`, `phase.key`, with optional `:requirement`. */
function parseConsumesSpec(spec: string): CatalogQuery["consumes"] {
  let rest = spec;
  let requirement: "required" | "optional" | undefined;
  const colon = rest.indexOf(":");
  if (colon !== -1) {
    const suffix = rest.slice(colon + 1);
    if (suffix !== "required" && suffix !== "optional") {
      throw new Error(
        `Invalid --consumes requirement ":${suffix}" (expected ":required" or ":optional").`
      );
    }
    requirement = suffix;
    rest = rest.slice(0, colon);
  }
  const dot = rest.indexOf(".");
  if (dot !== -1 && isPhase(rest.slice(0, dot))) {
    return {
      key: rest.slice(dot + 1),
      phase: rest.slice(0, dot) as Phase,
      requirement,
    };
  }
  if (rest.length === 0) {
    throw new Error("Invalid --consumes spec: key is empty.");
  }
  return { key: rest, requirement };
}

interface CatalogCliOptions {
  stepFiles: string[];
  tsConfigPath?: string;
  json: boolean;
  query: CatalogQuery;
}

function parseCatalogArgs(args: string[]): CatalogCliOptions {
  const options: CatalogCliOptions = { stepFiles: [], json: false, query: {} };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if ((arg === "--steps" || arg === "-s") && next) {
      options.stepFiles.push(next);
      i++;
    } else if (arg === "--tsconfig" && next) {
      options.tsConfigPath = next;
      i++;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--type" && next) {
      if (!isPhase(next)) {
        throw new Error(
          `Invalid --type "${next}" (expected given, when, or then).`
        );
      }
      options.query.stepType = next;
      i++;
    } else if (arg === "--text" && next) {
      options.query.text = next;
      i++;
    } else if (arg === "--consumes" && next) {
      options.query.consumes = parseConsumesSpec(next);
      i++;
    } else if (arg === "--produces" && next) {
      options.query.produces = next;
      i++;
    } else if (arg === "--source" && next) {
      options.query.sourceFile = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printCatalogUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown catalog option "${arg}".`);
    }
  }

  return options;
}

function formatDependencies(entry: CatalogEntry): string[] {
  const parts: string[] = [];
  for (const phase of PHASES) {
    for (const [key, requirement] of Object.entries(
      entry.dependencies[phase]
    )) {
      parts.push(`${phase}.${key} (${requirement})`);
    }
  }
  return parts;
}

function formatCatalogEntry(entry: CatalogEntry): string {
  const location = `${path.relative(process.cwd(), entry.sourceFile)}:${entry.line}`;
  const lines = [
    `${entry.stepType.padEnd(5)} "${entry.expression}"   ${location}`,
  ];
  const consumes = formatDependencies(entry);
  if (consumes.length > 0) {
    lines.push(`  consumes: ${consumes.join(", ")}`);
  }
  if (entry.produces.length > 0) {
    lines.push(`  produces: ${entry.produces.join(", ")}`);
  }
  return lines.join("\n");
}

async function runCatalog(args: string[]) {
  let options: CatalogCliOptions;
  try {
    options = parseCatalogArgs(args);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}\n`);
    printCatalogUsage();
    process.exit(1);
  }

  const { steps: stepFiles } = await resolveGlobs({
    steps: options.stepFiles,
  });

  const stepFilePaths = await globFiles(stepFiles);
  if (stepFilePaths.length === 0) {
    console.error(
      `Error: no step files matched ${stepFiles.map(g => `"${g}"`).join(", ")}.`
    );
    process.exit(1);
  }

  const catalog = await buildCatalog({
    stepFiles: stepFilePaths,
    tsConfigPath: options.tsConfigPath,
  });

  const steps = filterCatalog(catalog.steps, options.query);

  if (options.json) {
    console.log(JSON.stringify({ version: catalog.version, steps }, null, 2));
    return;
  }

  for (const entry of steps) {
    console.log(formatCatalogEntry(entry));
  }
  console.log(
    `${steps.length > 0 ? "\n" : ""}${steps.length} step definition(s)`
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "catalog") {
    await runCatalog(args.slice(1));
    return;
  }

  const config = parseArgs(args);
  const globs = await resolveGlobs({
    steps: config.stepFiles,
    features: config.featureFiles,
  });

  const stepFilePaths = await globFiles(globs.steps);
  if (stepFilePaths.length === 0) {
    console.error(
      `Error: no step files matched ${globs.steps.map(g => `"${g}"`).join(", ")}.`
    );
    process.exit(1);
  }
  const featureFilePaths = await globFiles(globs.features);
  if (featureFilePaths.length === 0) {
    console.error(
      `Error: no feature files matched ${globs.features.map(g => `"${g}"`).join(", ")}.`
    );
    process.exit(1);
  }

  const diagnostics = await analyze({
    stepFiles: stepFilePaths,
    featureFiles: featureFilePaths,
    tsConfigPath: config.tsConfigPath,
  });

  if (diagnostics.length === 0) {
    console.log("No issues found.");
    process.exit(0);
  }

  const errors = diagnostics.filter(d => d.severity === "error");
  const warnings = diagnostics.filter(d => d.severity === "warning");

  for (const diag of diagnostics) {
    console.log(formatDiagnostic(diag));
  }

  console.log(
    `\nFound ${errors.length} error(s) and ${warnings.length} warning(s).`
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

// Run main() only when this file is the process entry point, not when imported.
// Compare *real* paths: package managers expose the bin as a differently-named
// symlink (node_modules/.bin/step-forge-analyze -> dist/analyzer-cli.js), so
// `process.argv[1]` ends in "step-forge-analyze" while `import.meta.url` is the
// resolved module path. Resolving both through realpath makes the two match
// whether launched by bin name or by file path, under node or bun. The previous
// string/endsWith check silently did nothing when run via the installed bin.
function invokedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  main().catch(err => {
    console.error("Analyzer failed:", err);
    process.exit(1);
  });
}
