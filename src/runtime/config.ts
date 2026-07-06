import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";

/**
 * User-facing runner configuration. The same shape is accepted from a
 * `step-forge.config.ts` file (default export) and from CLI flags, with flags
 * taking precedence. Everything is optional; {@link resolveConfig} fills in
 * defaults.
 */
export interface RunnerOptions {
  /** Feature-file glob(s), relative to `cwd`. Defaults to every `.feature` file. */
  features?: string | string[];
  /** Step-module glob(s), relative to `cwd`. Defaults to every `.steps.ts` file. */
  steps?: string | string[];
  /**
   * Module that default-exports a world factory `() => world`, relative to
   * `cwd`. When omitted each scenario gets a fresh `BasicWorld`.
   */
  world?: string;
  /**
   * Max scenarios in flight at once. Defaults to `1` (serial), matching
   * Cucumber's default execution model — scenarios often share module-level
   * state via hooks, which only holds under serial execution. Raise it to opt
   * into parallelism for isolated, I/O-bound suites.
   */
  concurrency?: number;
  /** Reporter name. Default `pretty`. */
  reporter?: "pretty" | "progress";
  /** Only run scenarios whose name matches this (string → substring/regex). */
  name?: string;
  /** Cucumber tag expression, e.g. `@smoke and not @wip`. */
  tags?: string;
}

/** Fully-resolved config: no optionals, globs kept as arrays, paths absolute. */
export interface ResolvedConfig {
  cwd: string;
  features: string[];
  steps: string[];
  world?: string;
  concurrency: number;
  reporter: "pretty" | "progress";
  name?: string;
  tags?: string;
}

const DEFAULT_FEATURES = "**/*.feature";
const DEFAULT_STEPS = "**/*.steps.ts";
const CONFIG_BASENAMES = [
  "step-forge.config.ts",
  "step-forge.config.mts",
  "step-forge.config.js",
  "step-forge.config.mjs",
];

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate and import a `step-forge.config.*` file from `cwd`, returning its
 * default export (or `{}` if none is present). Imported by absolute file URL so
 * Bun transpiles the TypeScript config natively.
 */
export async function loadConfigFile(cwd: string): Promise<RunnerOptions> {
  for (const basename of CONFIG_BASENAMES) {
    const candidate = path.join(cwd, basename);
    if (!(await exists(candidate))) continue;
    const mod = await import(pathToFileURL(candidate).href);
    return (mod.default ?? mod) as RunnerOptions;
  }
  return {};
}

/**
 * Merge file config with CLI overrides and apply defaults. CLI overrides win
 * field-by-field; array globs are normalised to arrays and default when neither
 * source provides them.
 */
export function resolveConfig(
  cwd: string,
  file: RunnerOptions,
  cli: RunnerOptions
): ResolvedConfig {
  const pick = <K extends keyof RunnerOptions>(key: K): RunnerOptions[K] =>
    cli[key] ?? file[key];

  const features = toArray(pick("features"));
  const steps = toArray(pick("steps"));

  return {
    cwd,
    features: features.length ? features : [DEFAULT_FEATURES],
    steps: steps.length ? steps : [DEFAULT_STEPS],
    world: pick("world"),
    concurrency: pick("concurrency") ?? 1,
    reporter: pick("reporter") ?? "pretty",
    name: pick("name"),
    tags: pick("tags"),
  };
}
