#!/usr/bin/env node

import { analyze } from "./index.js";
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

Options:
  -s, --steps <glob>      Glob pattern for step definition files (repeatable)
  -f, --features <glob>   Glob pattern for feature files (repeatable)
  --tsconfig <path>       Path to tsconfig.json (default: auto-detect)
  -h, --help              Show this help message

Example:
  step-forge-analyze --steps "features/steps/**/*.ts" --features "features/**/*.feature"
`);
}

function formatDiagnostic(diag: Diagnostic): string {
  const location = `${diag.file}:${diag.range.startLine}:${diag.range.startColumn}`;
  return `${location} - ${diag.severity}: ${diag.message}`;
}

async function main() {
  const args = process.argv.slice(2);
  const config = parseArgs(args);

  if (config.stepFiles.length === 0 || config.featureFiles.length === 0) {
    console.error(
      "Error: Both --steps and --features are required.\n"
    );
    printUsage();
    process.exit(1);
  }

  const diagnostics = await analyze(config);

  if (diagnostics.length === 0) {
    console.log("No issues found.");
    process.exit(0);
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  for (const diag of diagnostics) {
    console.log(formatDiagnostic(diag));
  }

  console.log(
    `\nFound ${errors.length} error(s) and ${warnings.length} warning(s).`
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

// Only run when invoked directly (not when imported by Cucumber or other tools)
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("analyzer-cli.js") ||
  process.argv[1]?.endsWith("analyzer-cli.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error("Analyzer failed:", err);
    process.exit(1);
  });
}
