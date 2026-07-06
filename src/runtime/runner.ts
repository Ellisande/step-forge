/* eslint-disable @typescript-eslint/no-explicit-any */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { ParsedScenario } from "../analyzer/types";
import { parseFeatureFiles } from "../analyzer/gherkinParser";
import { globFiles } from "../globFiles";
import { BasicWorld, MergeableWorld } from "../world";
import {
  compileRegistry,
  CompiledStep,
  runScenario,
  ScenarioResult,
} from "./engine";
import { globalHookRegistry, runHooks, runHooksParallel } from "./hooks";
import { globalRegistry } from "./registry";
import { selectScenarios } from "./filter";
import { makeReporter, Reporter } from "./reporters";
import { ResolvedConfig } from "./config";

type WorldFactory = () => MergeableWorld<any, any, any>;

/**
 * Import every step-definition module so its `.step(...)` calls self-register
 * into the shared `globalRegistry`. Imported by file URL so Bun transpiles the
 * TypeScript natively.
 */
async function importSteps(files: string[]): Promise<void> {
  for (const file of files) {
    await import(pathToFileURL(file).href);
  }
}

/** Load the configured world factory, or default to a fresh `BasicWorld`. */
async function loadWorldFactory(
  world: string | undefined,
  cwd: string
): Promise<WorldFactory> {
  if (!world) return () => new BasicWorld();
  const resolved = path.resolve(cwd, world);
  const mod = await import(pathToFileURL(resolved).href);
  const factory = mod.default ?? mod;
  if (typeof factory !== "function") {
    throw new Error(
      `World module ${world} must default-export a factory function () => world`
    );
  }
  return factory as WorldFactory;
}

/** A scenario carrying `@skip` never runs: report it with all steps skipped. */
function skippedResult(scenario: ParsedScenario): ScenarioResult {
  return {
    scenario,
    status: "passed",
    steps: scenario.steps.map(step => ({ step, status: "skipped" as const })),
  };
}

/**
 * Run `items` through `worker`, at most `limit` in flight. Results come back in
 * input order even though completion order is not deterministic. A minimal
 * dependency-free pool — the whole point of the single-process model.
 */
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runNext = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  };
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    runNext
  );
  await Promise.all(workers);
  return results;
}

export interface RunResult {
  results: ScenarioResult[];
  passed: boolean;
  durationMs: number;
}

/**
 * Execute a whole run end to end: discover and import steps, load the world,
 * parse and select scenarios, then run them concurrently against a
 * compiled-once step table with global/feature hooks around the batch. Never
 * throws for test failures — inspect `RunResult.passed`.
 */
export async function run(
  config: ResolvedConfig,
  reporter: Reporter = makeReporter(config.reporter, config.cwd)
): Promise<RunResult> {
  const start =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const [featureFiles, stepFiles] = await Promise.all([
    globFiles(config.features, config.cwd),
    globFiles(config.steps, config.cwd),
  ]);

  await importSteps(stepFiles);
  const makeWorld = await loadWorldFactory(config.world, config.cwd);

  const compiled: CompiledStep[] = compileRegistry(globalRegistry);
  const allScenarios = parseFeatureFiles(featureFiles);
  const selected = selectScenarios(allScenarios, {
    name: config.name,
    tags: config.tags,
  });

  // Global `beforeAll` hooks run once, in parallel, before any scenario starts;
  // feature before/after bracket the whole batch inside them. (Hooks aren't
  // file-scoped in the registry, so per-file bracketing would be meaningless
  // under concurrent execution.)
  await runHooksParallel("global", "before", globalHookRegistry);
  await runHooks("feature", "before", globalHookRegistry);

  const results = await runPool(
    selected,
    config.concurrency,
    async scenario => {
      const result = scenario.tags.includes("@skip")
        ? skippedResult(scenario)
        : await runScenario(scenario, compiled, makeWorld, globalHookRegistry);
      reporter.onScenarioEnd?.(result);
      return result;
    }
  );

  await runHooks("feature", "after", globalHookRegistry);
  // Global `afterAll` hooks run once, in parallel, after every scenario is done.
  await runHooksParallel("global", "after", globalHookRegistry);

  const durationMs =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
    start;
  reporter.onComplete(results, durationMs);

  return {
    results,
    passed: results.every(r => r.status !== "failed"),
    durationMs,
  };
}
