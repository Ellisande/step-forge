#!/usr/bin/env bun
import { parseArgs } from "node:util";
import * as path from "node:path";
import { loadConfigFile, resolveConfig, RunnerOptions } from "./config";
import { run } from "./runner";
import { runInteractive } from "./interactive";
import { eventsReporter } from "./reporters";

const HELP = `step-forge — native TypeScript runner for Gherkin step definitions

Usage:
  step-forge [options] [feature globs...]

Options:
  -t, --tags <expr>        Tag expression, e.g. "@smoke and not @wip"
  -n, --name <pattern>     Only scenarios whose name matches (substring or /regex/)
  -s, --steps <glob>       Step-definition module glob (repeatable)
  -w, --world <module>     World factory module (default export () => world)
  -c, --concurrency <n>    Max scenarios in flight (default: 1, i.e. serial)
  -r, --reporter <name>    "pretty" (default), "progress", or "quiet"
  -p, --profile <name>     Use a named profile from the config file
  -v, --verbose            Report every scenario, not just failures
  -i, --interactive        Interactive watch mode: pick a tag/feature/scenario
                           and re-run it on every file change
      --config <path>      Config file directory (default: cwd)
  -h, --help               Show this help

Positional arguments are feature globs and override the configured features.
`;

/** Parse argv into config overrides. Positional args become feature globs. */
function parseCli(argv: string[]): {
  cwd: string;
  overrides: RunnerOptions;
  profile?: string;
  interactive: boolean;
  events: boolean;
} {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tags: { type: "string", short: "t" },
      name: { type: "string", short: "n" },
      steps: { type: "string", short: "s", multiple: true },
      world: { type: "string", short: "w" },
      concurrency: { type: "string", short: "c" },
      reporter: { type: "string", short: "r" },
      profile: { type: "string", short: "p" },
      verbose: { type: "boolean", short: "v" },
      interactive: { type: "boolean", short: "i" },
      // Hidden: emit NDJSON run events instead of human output. Used by the
      // interactive TUI, which spawns a child runner and renders results itself.
      events: { type: "boolean" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const overrides: RunnerOptions = {};
  if (positionals.length) overrides.features = positionals;
  if (values.tags) overrides.tags = values.tags;
  if (values.name) overrides.name = values.name;
  if (values.steps) overrides.steps = values.steps;
  if (values.world) overrides.world = values.world;
  if (values.verbose) overrides.verbose = true;
  if (values.reporter) {
    if (
      values.reporter !== "pretty" &&
      values.reporter !== "progress" &&
      values.reporter !== "quiet"
    ) {
      throw new Error(`Unknown reporter: ${values.reporter}`);
    }
    overrides.reporter = values.reporter;
  }
  if (values.concurrency !== undefined) {
    const n = Number(values.concurrency);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`--concurrency must be a positive integer`);
    }
    overrides.concurrency = n;
  }

  const cwd = values.config
    ? path.resolve(process.cwd(), values.config)
    : process.cwd();
  return {
    cwd,
    overrides,
    profile: values.profile,
    interactive: values.interactive ?? false,
    events: values.events ?? false,
  };
}

async function main(): Promise<void> {
  const { cwd, overrides, profile, interactive, events } = parseCli(
    process.argv.slice(2)
  );
  const fileConfig = await loadConfigFile(cwd);
  const config = resolveConfig(cwd, fileConfig, overrides, profile);
  if (interactive) {
    await runInteractive(config);
    return; // interactive mode manages its own lifecycle and exit code
  }
  const { passed } = events
    ? await run(config, eventsReporter({ cwd: config.cwd }))
    : await run(config);
  process.exitCode = passed ? 0 : 1;
}

main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
