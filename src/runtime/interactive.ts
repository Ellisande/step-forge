import { spawn } from "node:child_process";
import * as path from "node:path";
import { ParsedScenario } from "../analyzer/types";
import { ParsedFeature, parseFeatureCatalog } from "../analyzer/gherkinParser";
import { globFiles } from "../globFiles";
import { ResolvedConfig, ResolvedProfile } from "./config";
import { selectScenarios } from "./filter";
import { Prompt, Suggestion } from "./prompt";
import { RunEvent } from "./reporters";
import { watchFeatures, Watcher } from "./watcher";

/**
 * A population the user can pick and run: everything, a named profile, a whole
 * tag, a whole feature file, a single scenario, or a whole scenario outline (all
 * its example rows). Scenarios and outlines are keyed by name — an outline is one
 * choice that runs every row — so selection is stable across edits that shift
 * line numbers. Resolved against the freshly-parsed features on every run.
 */
type Choice =
  | { kind: "all" }
  | { kind: "profile"; id: string; tags?: string; name?: string }
  | { kind: "tag"; tag: string }
  | { kind: "feature"; file: string; name: string }
  | { kind: "scenario"; file: string; name: string };

const useColor =
  !process.env.NO_COLOR && (process.stdout.isTTY ?? false) === true;
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
    this.prompt.setSuggestions(
      buildSuggestions(this.catalog, this.config.profiles)
    );
  }

  // --- run cycle -----------------------------------------------------------
  private triggerRun(): void {
    if (!this.armed) return;
    if (this.running) {
      this.rerunQueued = true; // coalesce: run once more when the current ends
      return;
    }
    this.running = true;
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    try {
      do {
        this.rerunQueued = false;
        if (this.armed) await this.executeOnce(this.armed);
      } while (this.rerunQueued && this.armed && !this.dirty);
    } catch (err) {
      this.prompt.failureBlock(
        red(`run failed: ${err instanceof Error ? err.message : err}`)
      );
      this.prompt.complete(0);
    } finally {
      this.running = false;
      this.prompt.status = this.status();
      this.prompt.redraw();
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

    this.prompt.resetResults({
      label: choiceLabel(choice),
      scenarioCount: selected.length,
      runCount: ++this.runCount,
      clock: clock(),
    });

    if (selected.length === 0) {
      this.prompt.note(yellow("  no scenarios match this selection"));
      this.prompt.complete(0);
      return;
    }

    await this.spawnRun(runArgs(choice, this.config));
  }

  /** Every scenario across the current catalog, flattened. */
  private scenarios(): ParsedScenario[] {
    return this.catalog.flatMap(f => f.scenarios);
  }

  /**
   * Run `step-forge --events` as a child process and feed its NDJSON event
   * stream into the results region as it arrives — live tallies, dots, and
   * failure blocks. Re-invokes the very CLI that's running us (`process.execPath`
   * + `argv[1]`), so it works identically from the source tree and the built bin.
   * `FORCE_COLOR` keeps the child's rendered failure blocks coloured even though
   * its stdout is a pipe. Never rejects — errors are surfaced and swallowed so
   * the watch loop survives.
   */
  private spawnRun(args: string[]): Promise<void> {
    return new Promise(resolve => {
      const child = spawn(process.execPath, [process.argv[1], ...args], {
        cwd: this.config.cwd,
        env: { ...process.env, FORCE_COLOR: "1" },
        // Own stdin ourselves (raw-mode prompt); capture stdout (the event
        // stream) and stderr (a crash) so the parent owns all rendering.
        stdio: ["ignore", "pipe", "pipe"],
      });

      let completed = false;
      let durationMs = 0;
      let stdoutBuf = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBuf += chunk;
        let nl: number;
        while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          if (!line.trim()) continue;
          let evt: RunEvent;
          try {
            evt = JSON.parse(line) as RunEvent;
          } catch {
            continue; // ignore any non-event line
          }
          if (evt.t === "scenario") {
            this.prompt.scenario(evt.status, evt.steps, evt.detail);
          } else if (evt.t === "complete") {
            completed = true;
            durationMs = evt.durationMs;
          }
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", err => {
        this.prompt.failureBlock(red(`could not start runner: ${err.message}`));
        this.prompt.complete(0);
        resolve();
      });
      child.on("close", () => {
        if (completed) {
          this.prompt.complete(durationMs);
        } else {
          const detail = stderr.trim() || "(no output)";
          this.prompt.failureBlock(
            red(`runner exited without reporting results:\n${detail}`)
          );
          this.prompt.complete(0);
        }
        resolve();
      });
    });
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
/**
 * Build the typeahead pool: `@all`, every configured profile, then every tag,
 * feature, and scenario in the catalog.
 */
function buildSuggestions(
  catalog: ParsedFeature[],
  profiles: ResolvedProfile[]
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Synthetic top-of-list entry: run every configured scenario. Named `@all` so
  // it reads like a tag, but it is its own choice kind (not a real Gherkin tag).
  suggestions.push({
    badge: "all",
    label: "@all",
    search: "@all run everything all",
    value: { kind: "all" } satisfies Choice,
  });

  // Configured profiles sit near the top: each is one choice that runs the
  // profile's tag/name selection (its reporter and other settings apply when the
  // child runner resolves `--profile <id>`).
  for (const profile of profiles) {
    suggestions.push({
      badge: "profile",
      label: profile.id,
      search: `profile ${profile.id} ${profile.tags ?? ""}`.toLowerCase(),
      value: {
        kind: "profile",
        id: profile.id,
        tags: profile.tags,
        name: profile.name,
      } satisfies Choice,
    });
  }

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

    // Each row of a scenario outline shares the outline's name; collapse them
    // into a single choice (selected by the outline name, which runs every row)
    // rather than one entry per row. Regular scenarios stay one entry each.
    const seen = new Set<string>();
    for (const scenario of feature.scenarios) {
      const name = scenario.outline ? scenario.outline.name : scenario.name;
      if (seen.has(name)) continue;
      seen.add(name);
      suggestions.push({
        badge: scenario.outline ? "outline" : "scenario",
        label: name,
        search: `${featureLabel} ${name}`.toLowerCase(),
        value: { kind: "scenario", file: scenario.file, name } satisfies Choice,
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
    case "all":
      return scenarios;
    case "profile":
      // Apply the profile's tag/name selection exactly as the runner will (this
      // count ignores any profile-specific `features` narrowing; the child run,
      // launched with `--profile`, is authoritative).
      return selectScenarios(scenarios, {
        tags: choice.tags,
        name: choice.name,
      });
    case "tag":
      return scenarios.filter(s => s.tags.includes(choice.tag));
    case "feature":
      return scenarios.filter(s => s.file === choice.file);
    case "scenario":
      // Matches a regular scenario by its name, or every row of an outline by
      // the shared outline name — mirroring the runner's `-n` (name || outline).
      return scenarios.filter(
        s =>
          s.file === choice.file &&
          (s.name === choice.name || s.outline?.name === choice.name)
      );
  }
}

function choiceLabel(choice: Choice): string {
  switch (choice.kind) {
    case "all":
      return "@all";
    case "profile":
      return `profile ${choice.id}`;
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
 *   - all → every configured feature, unfiltered
 *   - profile → `--profile <id>`, letting the child re-resolve the whole profile
 *     (its own features/steps/world/concurrency/tags) from the shared config
 *     file; base flags are *not* forwarded so they can't clobber it
 *   - tag → all configured features, filtered by `-t <tag>`
 *   - feature → that single feature file
 *   - scenario → that feature file, name-anchored with `-n "/^…$/"` (the name is
 *     the outline name for an outline, so all its rows run)
 * Always `--events`: the child emits its NDJSON run stream and the TUI renders
 * the results region itself.
 */
function runArgs(choice: Choice, config: ResolvedConfig): string[] {
  // A profile is resolved end-to-end by the child from the shared config file,
  // so hand it only the name (plus `--events`) and let it own every setting.
  if (choice.kind === "profile") {
    return ["--profile", choice.id, "--events"];
  }

  const args: string[] = [];
  for (const glob of config.steps) args.push("-s", glob);
  if (config.world) args.push("-w", config.world);
  args.push("-c", String(config.concurrency));

  switch (choice.kind) {
    case "all":
      args.push(...config.features);
      break;
    case "tag":
      args.push(...config.features, "-t", choice.tag);
      break;
    case "feature":
      args.push(choice.file);
      break;
    case "scenario":
      args.push(choice.file, "-n", `/^${escapeRegExp(choice.name)}$/`);
      break;
  }

  args.push("--events");
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
