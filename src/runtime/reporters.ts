import { relative } from "node:path";
import { relativeFrame, relativeLocation, userFrames } from "../sourceLocation";
import { ScenarioResult, StepResult } from "./engine";

/**
 * A reporter observes the run. `onScenarioEnd` fires as each scenario finishes
 * (completion order, non-deterministic under concurrency); `onComplete` fires
 * once with every result for the end-of-run output.
 *
 * Every reporter accepts a `verbose` flag: without it a reporter reports only
 * failures (plus a summary); with it, it reports every scenario. A reporter may
 * render the same either way — `verbose` is a request, not a requirement.
 */
export interface Reporter {
  onScenarioEnd?(result: ScenarioResult): void;
  onComplete(results: ScenarioResult[], durationMs: number): void;
}

export interface ReporterOptions {
  cwd?: string;
  verbose?: boolean;
}

/**
 * One NDJSON line emitted by {@link eventsReporter}. This is the internal
 * parent↔child channel for `step-forge -i`: the TUI spawns a child runner with
 * `--events` and renders the results region itself from these events, so it can
 * pin the layout and reorder it (stats above dots above failures). Not a public
 * or stable schema — it exists only for interactive mode.
 */
export type RunEvent =
  | {
      t: "scenario";
      status: "passed" | "failed" | "skipped";
      name: string;
      /** Per-scenario step counts, so the parent can tally steps live. */
      steps: { passed: number; failed: number; skipped: number };
      /** Rendered Cucumber failure block; present only when the scenario failed. */
      detail?: string;
    }
  | { t: "complete"; durationMs: number };

// --- ANSI colouring -------------------------------------------------------
const useColor =
  !process.env.NO_COLOR &&
  (!!process.env.FORCE_COLOR || (process.stdout.isTTY ?? false) === true);

const wrap = (open: number, close: number) => (s: string) =>
  useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s;

const c = {
  green: wrap(32, 39),
  red: wrap(31, 39),
  yellow: wrap(33, 39),
  dim: wrap(2, 22),
  bold: wrap(1, 22),
};

const STATUS_MARK: Record<StepResult["status"], string> = {
  passed: c.green("✓"),
  failed: c.red("✗"),
  skipped: c.yellow("-"),
};

/** Display status of a whole scenario (skipped = every step skipped). */
function scenarioStatus(
  result: ScenarioResult
): "passed" | "failed" | "skipped" {
  if (result.status === "failed") return "failed";
  if (result.steps.every(s => s.status === "skipped")) return "skipped";
  return "passed";
}

/** The scenario's display name, prefixed with its outline name for outline rows. */
function scenarioLabel(result: ScenarioResult): string {
  return result.scenario.outline
    ? `${result.scenario.outline.name} › ${result.scenario.name}`
    : result.scenario.name;
}

/** ✓ / ✗ / - for a whole scenario (skipped = every step skipped). */
function scenarioMark(result: ScenarioResult): string {
  const status = scenarioStatus(result);
  if (status === "failed") return c.red("✗");
  if (status === "skipped") return c.yellow("-");
  return c.green("✓");
}

/** Dot per scenario for the live heartbeat: `.` pass / `F` fail / `-` skip. */
function scenarioDot(result: ScenarioResult): string {
  const status = scenarioStatus(result);
  if (status === "failed") return c.red("F");
  if (status === "skipped") return c.yellow("-");
  return c.green(".");
}

/** Indent every non-empty line of a block by `pad` spaces. */
function indent(text: string, pad: number): string {
  const prefix = " ".repeat(pad);
  return text
    .split("\n")
    .map(line => (line ? prefix + line : line))
    .join("\n");
}

/**
 * The error, trimmed to user frames: `Name: message` followed by only the
 * caller's own stack frames (library/engine and `node_modules` frames removed),
 * source-mapped by Bun to the original `.ts`. Falls back to just the message
 * when nothing user-owned is left (e.g. an undefined-step error).
 */
function renderError(error: Error, cwd: string): string {
  const header = `${error.name}: ${error.message}`;
  const frames = userFrames(error.stack).map(
    f => `    at ${relativeFrame(f, cwd)}`
  );
  return frames.length ? `${header}\n${frames.join("\n")}` : header;
}

/**
 * The detail block shown beneath a failing step: the `.feature` line, the step
 * definition location, and the trimmed error — the two coordinates that make a
 * failure easy to chase (where in the feature, which step definition).
 */
function failureDetail(
  stepResult: StepResult,
  result: ScenarioResult,
  cwd: string
): string {
  const lines = [
    `feature: ${relative(cwd, result.scenario.file)}:${stepResult.step.line}`,
  ];
  if (stepResult.source) {
    lines.push(`defined: ${relativeLocation(stepResult.source, cwd)}`);
  }
  if (stepResult.error) lines.push(renderError(stepResult.error, cwd));
  return indent(c.red(lines.join("\n")), 6);
}

/**
 * One scenario as a Cucumber-style block: a marked header with its `.feature`
 * location, then each step with its mark (and, in `verbose`, the step
 * definition location as a trailing comment). A failing step is followed by its
 * failure detail; a scenario-level error (a failing hook, no step to blame) is
 * appended at the end.
 */
function renderScenario(
  result: ScenarioResult,
  cwd: string,
  opts: { stepSource: boolean }
): string {
  const lines: string[] = [
    `${scenarioMark(result)} ${c.bold(scenarioLabel(result))}`,
  ];

  const loc = result.scenario.line
    ? `${relative(cwd, result.scenario.file)}:${result.scenario.line}`
    : relative(cwd, result.scenario.file);
  lines.push(indent(c.dim(loc), 4));
  lines.push("");

  for (const step of result.scenario.steps) {
    const sr = result.steps.find(s => s.step === step);
    const status = sr?.status ?? "skipped";
    const comment =
      opts.stepSource && sr?.source
        ? c.dim(`  # ${relativeLocation(sr.source, cwd)}`)
        : "";
    lines.push(
      `  ${STATUS_MARK[status]} ${c.dim(step.effectiveKeyword)} ${step.text}${comment}`
    );
    if (sr?.status === "failed") lines.push(failureDetail(sr, result, cwd));
  }

  // A hook failure has no failing step; surface its error at scenario level.
  const stepFailed = result.steps.some(s => s.status === "failed");
  if (result.error && !stepFailed) {
    lines.push(indent(c.red(renderError(result.error, cwd)), 4));
  }

  return lines.join("\n");
}

// --- Summary --------------------------------------------------------------
interface Totals {
  scenarios: { passed: number; failed: number; skipped: number };
  steps: { passed: number; failed: number; skipped: number };
}

function tally(results: ScenarioResult[]): Totals {
  const totals: Totals = {
    scenarios: { passed: 0, failed: 0, skipped: 0 },
    steps: { passed: 0, failed: 0, skipped: 0 },
  };
  for (const result of results) {
    if (result.status === "failed") totals.scenarios.failed++;
    else if (result.steps.every(s => s.status === "skipped"))
      totals.scenarios.skipped++;
    else totals.scenarios.passed++;
    for (const step of result.steps) totals.steps[step.status]++;
  }
  return totals;
}

function renderSummary(results: ScenarioResult[], durationMs: number): string {
  const t = tally(results);
  const scenarioTotal =
    t.scenarios.passed + t.scenarios.failed + t.scenarios.skipped;
  const stepTotal = t.steps.passed + t.steps.failed + t.steps.skipped;

  const part = (n: number, label: string, color: (s: string) => string) =>
    n > 0 ? color(`${n} ${label}`) : null;

  const line = (
    total: number,
    noun: string,
    counts: { passed: number; failed: number; skipped: number }
  ) => {
    const parts = [
      part(counts.passed, "passed", c.green),
      part(counts.failed, "failed", c.red),
      part(counts.skipped, "skipped", c.yellow),
    ].filter((x): x is string => x !== null);
    return `${total} ${noun}${total === 1 ? "" : "s"} (${parts.join(", ")})`;
  };

  return [
    line(scenarioTotal, "scenario", t.scenarios),
    line(stepTotal, "step", t.steps),
    c.dim(`${(durationMs / 1000).toFixed(2)}s`),
  ].join("\n");
}

function write(text: string): void {
  process.stdout.write(text);
}

/** Feature-grouped tree of every scenario (used by `--verbose`). */
function renderFullTree(results: ScenarioResult[], cwd: string): string {
  const groups = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    const bucket = groups.get(r.scenario.file) ?? [];
    bucket.push(r);
    groups.set(r.scenario.file, bucket);
  }
  const out: string[] = [];
  for (const [file, group] of groups) {
    out.push(c.bold(`Feature: ${relative(cwd, file)}`), "");
    for (const r of group)
      out.push(indent(renderScenario(r, cwd, { stepSource: true }), 2), "");
  }
  return out.join("\n");
}

/** The failing scenarios only (used by the default, non-verbose output). */
function renderFailures(results: ScenarioResult[], cwd: string): string {
  const failed = results.filter(r => r.status === "failed");
  if (!failed.length) return "";
  return (
    failed
      .map(r => renderScenario(r, cwd, { stepSource: false }))
      .join("\n\n") + "\n\n"
  );
}

/**
 * Default reporter. Non-verbose: a dot per scenario as a heartbeat, then the
 * failing scenarios in Cucumber-style detail, then the summary. Verbose: the
 * full feature → scenario → step tree instead of just failures.
 */
export function prettyReporter(opts: ReporterOptions = {}): Reporter {
  const cwd = opts.cwd ?? process.cwd();
  const verbose = opts.verbose ?? false;
  return {
    onScenarioEnd(result) {
      if (!verbose) write(scenarioDot(result));
    },
    onComplete(results, durationMs) {
      const body = verbose
        ? `\n${renderFullTree(results, cwd)}\n`
        : `\n\n${renderFailures(results, cwd)}`;
      write(`${body}${renderSummary(results, durationMs)}\n`);
    },
  };
}

/**
 * Compact reporter: a dot per scenario, then failures in detail and the
 * summary. Always minimal — `verbose` is accepted for interface parity but does
 * not expand the output (use `pretty --verbose` for the full tree).
 */
export function progressReporter(opts: ReporterOptions = {}): Reporter {
  const cwd = opts.cwd ?? process.cwd();
  return {
    onScenarioEnd(result) {
      write(scenarioDot(result));
    },
    onComplete(results, durationMs) {
      write(
        `\n\n${renderFailures(results, cwd)}${renderSummary(results, durationMs)}\n`
      );
    },
  };
}

export function makeReporter(
  name: "pretty" | "progress",
  opts: ReporterOptions = {}
): Reporter {
  return name === "progress" ? progressReporter(opts) : prettyReporter(opts);
}

/**
 * Internal reporter for interactive mode. Emits one {@link RunEvent} per line
 * (NDJSON) and nothing human-facing, so a parent process can parse the stream
 * and own the rendering. Failure detail reuses {@link renderScenario} verbatim,
 * so the TUI's failures pane matches the non-interactive output.
 */
export function eventsReporter(opts: ReporterOptions = {}): Reporter {
  const cwd = opts.cwd ?? process.cwd();
  const emit = (evt: RunEvent): void => write(`${JSON.stringify(evt)}\n`);
  return {
    onScenarioEnd(result) {
      const steps = { passed: 0, failed: 0, skipped: 0 };
      for (const s of result.steps) steps[s.status]++;
      const status = scenarioStatus(result);
      emit({
        t: "scenario",
        status,
        name: scenarioLabel(result),
        steps,
        detail:
          status === "failed"
            ? renderScenario(result, cwd, { stepSource: false })
            : undefined,
      });
    },
    onComplete(_results, durationMs) {
      emit({ t: "complete", durationMs });
    },
  };
}
