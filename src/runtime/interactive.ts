import { spawn } from "node:child_process";
import * as path from "node:path";
import { ParsedScenario } from "../analyzer/types";
import { ParsedFeature, parseFeatureCatalog } from "../analyzer/gherkinParser";
import { globFiles } from "../globFiles";
import { ResolvedConfig } from "./config";
import { Prompt, Suggestion } from "./prompt";
import { watchFeatures, Watcher } from "./watcher";

/**
 * A population the user can pick and run: a whole tag, a whole feature file, or
 * a single scenario. Resolved against the freshly-parsed features on every run,
 * so it survives edits that shift line numbers.
 */
type Choice =
  | { kind: "tag"; tag: string }
  | { kind: "feature"; file: string; name: string }
  | { kind: "scenario"; file: string; name: string; line?: number };

const useColor =
  !process.env.NO_COLOR && (process.stdout.isTTY ?? false) === true;
const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
const red = (s: string) => (useColor ? `\x1b[31m${s}\x1b[39m` : s);
const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[39m` : s);

/**
 * Entry point for `step-forge -i`. Brings up the always-live typeahead prompt,
 * watches the configured feature/step directories, and re-runs the armed
 * population on every relevant file change. Requires a TTY.
 */
export async function runInteractive(config: ResolvedConfig): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "Interactive mode (-i) requires a TTY; stdin is not a terminal.\n"
    );
    process.exitCode = 1;
    return;
  }
  await new InteractiveSession(config).start();
}

class InteractiveSession {
  private readonly config: ResolvedConfig;
  private readonly prompt: Prompt;
  private watcher?: Watcher;
  private catalog: ParsedFeature[] = [];

  // State machine: `armed` is the committed population; `dirty` means the query
  // was edited since the last commit, which suspends file-change re-runs.
  private armed: Choice | null = null;
  private dirty = false;
  private running = false;
  private rerunQueued = false;
  /** Increments per run so back-to-back identical output is still distinguishable. */
  private runCount = 0;

  private done!: () => void;

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.prompt = new Prompt({
      initialQuery: config.tags ?? config.name ?? "",
      handlers: {
        onSubmit: value => this.onSubmit(value),
        onEdit: () => this.onEdit(),
        onEscape: () => this.onEscape(),
        onQuit: () => this.onQuit(),
      },
    });
  }

  async start(): Promise<void> {
    await this.rebuildCatalog();
    this.prompt.status = this.status();
    this.prompt.start();
    this.watcher = watchFeatures(
      [...this.config.features, ...this.config.steps],
      this.config.cwd,
      () => void this.onFsChange()
    );
    await new Promise<void>(resolve => {
      this.done = resolve;
    });
  }

  // --- prompt events -------------------------------------------------------
  private onSubmit(value: unknown | null): void {
    if (!value) return; // nothing highlighted (empty query / no matches)
    this.armed = value as Choice;
    this.dirty = false;
    this.prompt.status = this.status();
    this.triggerRun();
  }

  private onEdit(): void {
    // Editing the query suspends auto-runs until the next Enter re-commits.
    if (this.armed) this.dirty = true;
    this.prompt.status = this.status();
    this.prompt.redraw();
  }

  private onEscape(): void {
    if (!this.armed) return;
    this.armed = null;
    this.dirty = false;
    this.prompt.status = this.status();
    this.prompt.redraw();
  }

  private onQuit(): void {
    this.watcher?.close();
    this.prompt.stop();
    process.stdout.write("\n");
    process.exitCode = 0;
    this.done?.();
  }

  // --- filesystem watch ----------------------------------------------------
  private async onFsChange(): Promise<void> {
    await this.rebuildCatalog();
    if (this.armed && !this.dirty) this.triggerRun();
  }

  private async rebuildCatalog(): Promise<void> {
    try {
      const featureFiles = await globFiles(
        this.config.features,
        this.config.cwd
      );
      this.catalog = parseFeatureCatalog(featureFiles);
    } catch {
      // A half-written feature mid-save may fail to parse; keep the old cache.
    }
    this.prompt.setSuggestions(buildSuggestions(this.catalog));
  }

  // --- run cycle -----------------------------------------------------------
  private triggerRun(): void {
    if (!this.armed) return;
    if (this.running) {
      this.rerunQueued = true; // coalesce: run once more when the current ends
      return;
    }
    this.running = true;
    this.prompt.beginOutput();
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    try {
      do {
        this.rerunQueued = false;
        if (this.armed) await this.executeOnce(this.armed);
      } while (this.rerunQueued && this.armed && !this.dirty);
    } catch (err) {
      process.stdout.write(
        red(`\n  run failed: ${err instanceof Error ? err.message : err}\n`)
      );
    } finally {
      this.running = false;
      this.prompt.status = this.status();
      this.prompt.endOutput(); // redraws the prompt below the run's output
    }
  }

  /**
   * One run of `choice`: resolve its scenarios against the current parse, then
   * shell out to a **fresh** `step-forge` process scoped to just that
   * population. A child process is used deliberately — Bun caches ES modules for
   * the life of a process and ignores query-string cache-busting, so re-running
   * in-process would never pick up edited step code. A new process re-reads
   * every step/feature file, which is exactly what a watch loop needs.
   */
  private async executeOnce(choice: Choice): Promise<void> {
    const selected = resolveScenarios(choice, this.scenarios());

    const count = `${selected.length} scenario${selected.length === 1 ? "" : "s"}`;
    process.stdout.write(
      `\n${bold(`▶ ${choiceLabel(choice)}`)} ${dim(
        `(${count} · run #${++this.runCount} · ${clock()})`
      )}\n\n`
    );

    if (selected.length === 0) {
      process.stdout.write(yellow("  no scenarios match this selection\n"));
      return;
    }

    // A single scenario is analyzed (dependency/undefined/ambiguous checks) and
    // run verbose; a broader population uses the configured reporter.
    const single = selected.length === 1;
    if (single) await this.analyzeScenario(selected[0]);

    await this.spawnRun(runArgs(choice, selected[0], single, this.config));
  }

  /** Every scenario across the current catalog, flattened. */
  private scenarios(): ParsedScenario[] {
    return this.catalog.flatMap(f => f.scenarios);
  }

  /**
   * Run `step-forge` as a child process with `args`, streaming its output to the
   * terminal (where the erased prompt was). Re-invokes the very CLI that's
   * running us (`process.execPath` + `argv[1]`), so it works identically from
   * the source tree and the built bin. Never rejects — a spawn error is reported
   * and swallowed so the watch loop survives.
   */
  private spawnRun(args: string[]): Promise<void> {
    return new Promise(resolve => {
      const child = spawn(process.execPath, [process.argv[1], ...args], {
        cwd: this.config.cwd,
        // Own stdin ourselves (raw-mode prompt); let the child inherit our
        // stdout/stderr so its reporter output lands above the prompt live.
        stdio: ["ignore", "inherit", "inherit"],
      });
      child.on("error", err => {
        process.stdout.write(red(`  could not start runner: ${err.message}\n`));
        resolve();
      });
      child.on("close", () => resolve());
    });
  }

  /**
   * Run the static analyzer over a single scenario and print any dependency /
   * undefined / ambiguous diagnostics. The analyzer needs the optional
   * `typescript` peer for AST extraction; if it's absent we note that and skip,
   * never failing the run.
   */
  private async analyzeScenario(scenario: ParsedScenario): Promise<void> {
    let analyzer: typeof import("../analyzer/index");
    try {
      analyzer = await import("../analyzer/index");
    } catch {
      process.stdout.write(
        dim("  analysis skipped: install `typescript` to enable it\n\n")
      );
      return;
    }
    try {
      const stepFiles = await globFiles(this.config.steps, this.config.cwd);
      const defs = analyzer.extractStepDefinitions(stepFiles);
      const matched = analyzer.matchScenarioSteps(scenario, defs);
      const diagnostics = analyzer.defaultRules.flatMap(rule =>
        rule.check(scenario, matched)
      );
      printDiagnostics(diagnostics, this.config.cwd);
    } catch (err) {
      process.stdout.write(
        dim(
          `  analysis unavailable: ${err instanceof Error ? err.message : err}\n\n`
        )
      );
    }
  }

  // --- status line ---------------------------------------------------------
  private status(): string {
    if (!this.armed) {
      return "  type to filter · ↑↓ move · enter run · ctrl-c quit";
    }
    if (this.dirty) {
      return "  ⏸ suspended (query edited) · enter runs the selection · esc cancel";
    }
    return `  ▶ watching ${choiceLabel(this.armed)} · save a file to re-run · enter forces · esc change · ctrl-c quit`;
  }
}

// --- choices ---------------------------------------------------------------
/** Build the typeahead pool: every tag, feature, and scenario in the catalog. */
function buildSuggestions(catalog: ParsedFeature[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  const tags = new Set<string>();
  for (const feature of catalog) {
    for (const scenario of feature.scenarios) {
      for (const tag of scenario.tags) tags.add(tag);
    }
  }
  for (const tag of [...tags].sort()) {
    suggestions.push({
      badge: "#tag",
      label: tag,
      search: tag.toLowerCase(),
      value: { kind: "tag", tag } satisfies Choice,
    });
  }

  for (const feature of catalog) {
    const featureLabel = feature.name || path.basename(feature.file);
    suggestions.push({
      badge: "feature",
      label: featureLabel,
      search: `${feature.name} ${feature.file}`.toLowerCase(),
      value: {
        kind: "feature",
        file: feature.file,
        name: feature.name,
      } satisfies Choice,
    });

    for (const scenario of feature.scenarios) {
      const scenarioName = scenario.outline
        ? `${scenario.outline.name} › ${scenario.name}`
        : scenario.name;
      suggestions.push({
        badge: "scenario",
        label: scenarioName,
        search: `${featureLabel} ${scenarioName}`.toLowerCase(),
        value: {
          kind: "scenario",
          file: scenario.file,
          name: scenario.name,
          line: scenario.line,
        } satisfies Choice,
      });
    }
  }

  return suggestions;
}

/** Resolve a choice to its scenarios against the current parse. */
function resolveScenarios(
  choice: Choice,
  scenarios: ParsedScenario[]
): ParsedScenario[] {
  switch (choice.kind) {
    case "tag":
      return scenarios.filter(s => s.tags.includes(choice.tag));
    case "feature":
      return scenarios.filter(s => s.file === choice.file);
    case "scenario":
      return scenarios.filter(
        s =>
          s.file === choice.file &&
          s.name === choice.name &&
          (choice.line === undefined || s.line === choice.line)
      );
  }
}

function choiceLabel(choice: Choice): string {
  switch (choice.kind) {
    case "tag":
      return choice.tag;
    case "feature":
      return choice.name || path.basename(choice.file);
    case "scenario":
      return choice.name;
  }
}

/**
 * The `step-forge` argv that reproduces this selection in a child process. The
 * base flags forward the resolved config (steps/world/concurrency) so the child
 * matches the parent's setup regardless of its own config file; the scope flags
 * narrow to the chosen population:
 *   - tag → all configured features, filtered by `-t <tag>`
 *   - feature → that single feature file
 *   - scenario → that feature file, name-anchored with `-n "/^…$/"`
 * A single scenario runs verbose; a population uses the configured reporter.
 */
function runArgs(
  choice: Choice,
  first: ParsedScenario,
  single: boolean,
  config: ResolvedConfig
): string[] {
  const args: string[] = [];
  for (const glob of config.steps) args.push("-s", glob);
  if (config.world) args.push("-w", config.world);
  args.push("-c", String(config.concurrency));

  switch (choice.kind) {
    case "tag":
      args.push(...config.features, "-t", choice.tag);
      break;
    case "feature":
      args.push(choice.file);
      break;
    case "scenario":
      args.push(choice.file, "-n", `/^${escapeRegExp(first.name)}$/`);
      break;
  }

  if (single) {
    args.push("-v");
  } else {
    args.push("-r", config.reporter);
    if (config.verbose) args.push("-v");
  }
  return args;
}

/** Escape a scenario name for use inside an anchored `-n` regex. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Local wall-clock time as `HH:MM:SS`, so each run's header is dated. */
function clock(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, "0"))
    .join(":");
}

// --- diagnostics -----------------------------------------------------------
function printDiagnostics(
  diagnostics: import("../analyzer/types").Diagnostic[],
  cwd: string
): void {
  if (diagnostics.length === 0) return; // clean scenario: say nothing, let the run speak
  process.stdout.write(bold("  analyzer:\n"));
  for (const d of diagnostics) {
    const mark =
      d.severity === "error"
        ? red("✗")
        : d.severity === "warning"
          ? yellow("!")
          : dim("i");
    const loc = `${path.relative(cwd, d.file)}:${d.range.startLine}`;
    process.stdout.write(`  ${mark} ${d.message} ${dim(`(${loc})`)}\n`);
  }
  process.stdout.write("\n");
}
