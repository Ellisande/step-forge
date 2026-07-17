import { globFiles } from "../globFiles.js";
import { extractStepDefinitions } from "./stepExtractor.js";
import type { StepDefinitionMeta } from "./types.js";

/** Config for building a step catalog. Only step files are needed. */
export interface CatalogConfig {
  /** Globs or literal absolute paths, same semantics as `AnalyzerConfig.stepFiles`. */
  stepFiles: string[];
  tsConfigPath?: string;
}

/** One implemented step definition. Superset of `StepDefinitionMeta`. */
export interface CatalogEntry extends StepDefinitionMeta {
  /** Stable identifier: `${sourceFile}:${line}`. */
  id: string;
}

/**
 * The catalog envelope; `JSON.stringify(catalog)` is the documented wire
 * format consumed by external tools (IDE plugins, agent skills).
 */
export interface StepCatalog {
  /** Schema version. Bumped only on breaking shape changes. */
  version: 1;
  steps: CatalogEntry[];
}

export type Phase = "given" | "when" | "then";

const ALL_PHASES: Phase[] = ["given", "when", "then"];

export interface ConsumesQuery {
  /** State key name (exact match). */
  key: string;
  /** Restrict to one dependency phase; omitted = match any phase. */
  phase?: Phase;
  /** Restrict to required/optional; omitted = either. */
  requirement?: "required" | "optional";
}

/** All fields optional; populated fields AND together. `{}` matches everything. */
export interface CatalogQuery {
  stepType?: Phase;
  /** Case-insensitive substring match on `expression`. */
  text?: string;
  /** Case-insensitive substring match on `sourceFile`. */
  sourceFile?: string;
  /** Step consumes this state key via `.dependencies()`. */
  consumes?: ConsumesQuery;
  /** Step's statically-inferred produced state includes this key (exact match, best-effort). */
  produces?: string;
}

/**
 * Build a catalog of every step definition found in `stepFiles`, using the
 * same static extraction as `analyze()`. No step code is executed. Entries are
 * sorted by (sourceFile, line) so output is deterministic across runs.
 */
export async function buildCatalog(
  config: CatalogConfig
): Promise<StepCatalog> {
  const stepFilePaths = await globFiles(config.stepFiles);
  const definitions = extractStepDefinitions(
    stepFilePaths,
    config.tsConfigPath
  );
  const steps = definitions
    .map(def => ({ ...def, id: `${def.sourceFile}:${def.line}` }))
    .sort(
      (a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.line - b.line
    );
  return { version: 1, steps };
}

function matchesConsumes(entry: CatalogEntry, query: ConsumesQuery): boolean {
  const phases = query.phase ? [query.phase] : ALL_PHASES;
  return phases.some(phase => {
    const requirement = entry.dependencies[phase][query.key];
    if (requirement === undefined) return false;
    return query.requirement === undefined || requirement === query.requirement;
  });
}

/** Filter catalog entries; pure, so consumers can build once and re-query. */
export function filterCatalog(
  steps: CatalogEntry[],
  query: CatalogQuery
): CatalogEntry[] {
  return steps.filter(entry => {
    if (query.stepType && entry.stepType !== query.stepType) return false;
    if (
      query.text &&
      !entry.expression.toLowerCase().includes(query.text.toLowerCase())
    ) {
      return false;
    }
    if (
      query.sourceFile &&
      !entry.sourceFile.toLowerCase().includes(query.sourceFile.toLowerCase())
    ) {
      return false;
    }
    if (query.consumes && !matchesConsumes(entry, query.consumes)) {
      return false;
    }
    if (query.produces && !entry.produces.includes(query.produces)) {
      return false;
    }
    return true;
  });
}
