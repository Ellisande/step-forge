import { relative } from "node:path";
import { ScenarioResult, StepResult } from "./engine";

/**
 * A reporter observes the run. `onScenarioEnd` fires as each scenario finishes
 * (order is completion order, which under concurrency is non-deterministic);
 * `onComplete` fires once with every result for end-of-run summaries.
 */
export interface Reporter {
  onScenarioEnd?(result: ScenarioResult): void;
  onComplete(results: ScenarioResult[], durationMs: number): void;
}

// --- ANSI colouring -------------------------------------------------------
// Honour NO_COLOR and non-TTY output; no dependency on a colour library.
const useColor =
  !process.env.NO_COLOR && (process.stdout.isTTY ?? false) === true;

const wrap = (open: number, close: number) => (s: string) =>
  useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s;

const c = {
  green: wrap(32, 39),
  red: wrap(31, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  dim: wrap(2, 22),
  bold: wrap(1, 22),
};

const STATUS_MARK: Record<StepResult["status"], string> = {
  passed: c.green("✓"),
  failed: c.red("✗"),
  skipped: c.yellow("-"),
};

/** Indent every line of a block by `pad` spaces. */
function indent(text: string, pad: number): string {
  const prefix = " ".repeat(pad);
  return text
    .split("\n")
    .map(line => (line ? prefix + line : line))
    .join("\n");
}

/** Render one scenario as a Cucumber-style tree of steps. */
function renderScenario(result: ScenarioResult): string {
  const lines: string[] = [];
  const label = result.scenario.outline
    ? `${result.scenario.outline.name} › ${result.scenario.name}`
    : result.scenario.name;
  lines.push(`  Scenario: ${label}`);

  for (const step of result.scenario.steps) {
    const stepResult = result.steps.find(s => s.step === step);
    const status = stepResult?.status ?? "skipped";
    lines.push(
      `    ${STATUS_MARK[status]} ${c.dim(step.effectiveKeyword)} ${step.text}`
    );
  }

  if (result.error) {
    const stack = result.error.stack ?? String(result.error);
    lines.push(indent(c.red(stack), 6));
  }
  return lines.join("\n");
}

/** Group results by feature file, preserving first-seen order. */
function groupByFeature(
  results: ScenarioResult[]
): Map<string, ScenarioResult[]> {
  const groups = new Map<string, ScenarioResult[]>();
  for (const result of results) {
    const key = result.scenario.file;
    const bucket = groups.get(key);
    if (bucket) bucket.push(result);
    else groups.set(key, [result]);
  }
  return groups;
}

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

/** The shared end-of-run summary block: counts + duration. */
function renderSummary(results: ScenarioResult[], durationMs: number): string {
  const t = tally(results);
  const scenarioTotal =
    t.scenarios.passed + t.scenarios.failed + t.scenarios.skipped;
  const stepTotal = t.steps.passed + t.steps.failed + t.steps.skipped;

  const part = (
    n: number,
    label: string,
    color: (s: string) => string
  ): string | null => (n > 0 ? color(`${n} ${label}`) : null);

  const scenarioParts = [
    part(t.scenarios.passed, "passed", c.green),
    part(t.scenarios.failed, "failed", c.red),
    part(t.scenarios.skipped, "skipped", c.yellow),
  ].filter((x): x is string => x !== null);

  const stepParts = [
    part(t.steps.passed, "passed", c.green),
    part(t.steps.failed, "failed", c.red),
    part(t.steps.skipped, "skipped", c.yellow),
  ].filter((x): x is string => x !== null);

  const seconds = (durationMs / 1000).toFixed(2);
  return [
    `${scenarioTotal} scenario${scenarioTotal === 1 ? "" : "s"} (${scenarioParts.join(", ")})`,
    `${stepTotal} step${stepTotal === 1 ? "" : "s"} (${stepParts.join(", ")})`,
    c.dim(`${seconds}s`),
  ].join("\n");
}

/**
 * Default reporter: prints the full feature → scenario → step tree grouped by
 * file, then the summary. Buffers to `onComplete` so concurrent scenarios don't
 * interleave mid-tree.
 */
export function prettyReporter(cwd: string = process.cwd()): Reporter {
  return {
    onComplete(results, durationMs) {
      const out: string[] = [];
      for (const [file, group] of groupByFeature(results)) {
        const featureName = group[0].scenario.file;
        out.push(c.bold(`Feature: ${relative(cwd, featureName || file)}`));
        for (const result of group) out.push(renderScenario(result));
        out.push("");
      }
      out.push(renderSummary(results, durationMs));
      process.stdout.write(out.join("\n") + "\n");
    },
  };
}

/**
 * Compact reporter: one character per scenario as it finishes (`.`/`F`/`-`),
 * then failures in detail and the summary. Best for large suites.
 */
export function progressReporter(cwd: string = process.cwd()): Reporter {
  return {
    onScenarioEnd(result) {
      const mark =
        result.status === "failed"
          ? c.red("F")
          : result.steps.every(s => s.status === "skipped")
            ? c.yellow("-")
            : c.green(".");
      process.stdout.write(mark);
    },
    onComplete(results, durationMs) {
      const failures = results.filter(r => r.status === "failed");
      const out: string[] = ["", ""];
      if (failures.length) {
        out.push(c.bold("Failures:"), "");
        for (const result of failures) {
          out.push(
            c.bold(`Feature: ${relative(cwd, result.scenario.file)}`),
            renderScenario(result),
            ""
          );
        }
      }
      out.push(renderSummary(results, durationMs));
      process.stdout.write(out.join("\n") + "\n");
    },
  };
}

export function makeReporter(
  name: "pretty" | "progress",
  cwd?: string
): Reporter {
  return name === "progress" ? progressReporter(cwd) : prettyReporter(cwd);
}
