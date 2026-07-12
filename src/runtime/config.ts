import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";

/** Built-in reporter names. */
export type ReporterName = "pretty" | "progress" | "quiet";

/**
 * Options shared by the base config and every profile. Everything is optional;
 * {@link resolveConfig} fills in defaults.
 */
export interface CommonRunnerOptions {
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
  reporter?: ReporterName;
  /**
   * Verbose output: report every scenario (pass, fail, skip) instead of only
   * failures. Passed to whichever reporter is active. Default `false`.
   */
  verbose?: boolean;
  /** Only run scenarios whose name matches this (string → substring/regex). */
  name?: string;
}

/**
 * A named preset selected with `--profile <name>` (or from the interactive
 * picker). Supports every base option, and additionally lets `tags` be a **list**
 * of tags — combined as a logical OR (run scenarios carrying any of them) — as
 * well as a single Cucumber tag expression. When a profile is active its values
 * layer over the base config (and are themselves overridden by CLI flags).
 */
export interface Profile extends CommonRunnerOptions {
  /**
   * A Cucumber tag expression (e.g. `@smoke and not @wip`) **or** a list of tags
   * run as a logical OR: `["@smoke", "@fast"]` selects scenarios tagged `@smoke`
   * OR `@fast`.
   */
  tags?: string | string[];
}

/**
 * User-facing runner configuration. The same shape is accepted from a
 * `step-forge.config.ts` file (default export) and from CLI flags, with flags
 * taking precedence. Everything is optional; {@link resolveConfig} fills in
 * defaults.
 */
export interface RunnerOptions extends CommonRunnerOptions {
  /** Cucumber tag expression, e.g. `@smoke and not @wip`. */
  tags?: string;
  /**
   * Named presets, keyed by name. Each supports the same options as the base
   * config (plus a tag list). Select one with `--profile <name>`; profiles also
   * appear as choices in the interactive picker (`-i`).
   */
  profiles?: Record<string, Profile>;
}

/**
 * A profile flattened for consumers that only need its scenario-selection
 * criteria (the interactive picker). `tags`/`name` already have the base config
 * layered underneath.
 */
export interface ResolvedProfile {
  /** Profile name (its key in `profiles`). */
  id: string;
  /** Normalised tag expression (a list is OR-joined), if any. */
  tags?: string;
  /** Name filter, if any. */
  name?: string;
}

/** Fully-resolved config: no optionals, globs kept as arrays, paths absolute. */
export interface ResolvedConfig {
  cwd: string;
  features: string[];
  steps: string[];
  world?: string;
  concurrency: number;
  reporter: ReporterName;
  verbose: boolean;
  name?: string;
  tags?: string;
  /** Every configured profile, flattened for the interactive picker. */
  profiles: ResolvedProfile[];
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
 * Normalise a profile's `tags` (a tag expression string or a list of tags) into
 * a single Cucumber tag expression. A list is combined as a logical OR, so
 * `["@smoke", "@fast"]` becomes `@smoke or @fast`. Returns `undefined` for an
 * absent or empty list.
 */
export function normalizeTags(
  tags: string | string[] | undefined
): string | undefined {
  if (tags === undefined) return undefined;
  if (typeof tags === "string") return tags;
  const atoms = tags.filter(t => t.trim().length > 0);
  if (atoms.length === 0) return undefined;
  if (atoms.length === 1) return atoms[0];
  return `(${atoms.join(" or ")})`;
}

/**
 * Look up a selected profile and return its options as base-config overrides,
 * with `tags` normalised to a single expression. Throws on an unknown name so a
 * bad `--profile` fails loudly. Returns `{}` when no profile is selected.
 */
function resolveProfileOverrides(
  file: RunnerOptions,
  profileName: string | undefined
): Partial<RunnerOptions> {
  if (!profileName) return {};
  const profile = file.profiles?.[profileName];
  if (!profile) {
    const known = Object.keys(file.profiles ?? {});
    const list = known.length
      ? known.map(n => `"${n}"`).join(", ")
      : "(none defined)";
    throw new Error(
      `Unknown profile "${profileName}". Known profiles: ${list}.`
    );
  }
  const { tags, ...rest } = profile;
  return { ...rest, tags: normalizeTags(tags) };
}

/** Flatten every configured profile's selection criteria for the picker. */
function resolveProfileList(file: RunnerOptions): ResolvedProfile[] {
  return Object.entries(file.profiles ?? {}).map(([id, p]) => ({
    id,
    tags: normalizeTags(p.tags) ?? file.tags,
    name: p.name ?? file.name,
  }));
}

/**
 * Merge file config with an optional profile and CLI overrides, then apply
 * defaults. Precedence is CLI > profile > base file config, field-by-field;
 * array globs are normalised to arrays and default when no source provides them.
 */
export function resolveConfig(
  cwd: string,
  file: RunnerOptions,
  cli: RunnerOptions,
  profileName?: string
): ResolvedConfig {
  const profile = resolveProfileOverrides(file, profileName);
  const pick = <K extends keyof RunnerOptions>(key: K): RunnerOptions[K] =>
    cli[key] ?? profile[key] ?? file[key];

  const features = toArray(pick("features"));
  const steps = toArray(pick("steps"));

  return {
    cwd,
    features: features.length ? features : [DEFAULT_FEATURES],
    steps: steps.length ? steps : [DEFAULT_STEPS],
    world: pick("world"),
    concurrency: pick("concurrency") ?? 1,
    reporter: pick("reporter") ?? "pretty",
    verbose: pick("verbose") ?? false,
    name: pick("name"),
    tags: pick("tags"),
    profiles: resolveProfileList(file),
  };
}
