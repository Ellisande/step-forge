import { globFiles } from "../globFiles.js";
import { extractStepDefinitions } from "./stepExtractor.js";
import { parseFeatureFiles, parseFeatureContent } from "./gherkinParser.js";
import { matchScenarioSteps, findMatchingDefinitions } from "./stepMatcher.js";
import { defaultRules, runRules } from "./rules/index.js";
import { buildCatalog, filterCatalog } from "./catalog.js";
import type {
  AnalyzerConfig,
  AnalysisRule,
  Diagnostic,
  StepDefinitionMeta,
  ParsedScenario,
  MatchedStep,
  ParsedStep,
} from "./types.js";

export type {
  AnalyzerConfig,
  AnalysisRule,
  Diagnostic,
  StepDefinitionMeta,
  ParsedScenario,
  MatchedStep,
  ParsedStep,
};

export {
  extractStepDefinitions,
  parseFeatureFiles,
  parseFeatureContent,
  matchScenarioSteps,
  findMatchingDefinitions,
  defaultRules,
  buildCatalog,
  filterCatalog,
};

export type {
  CatalogConfig,
  CatalogEntry,
  StepCatalog,
  CatalogQuery,
  ConsumesQuery,
  Phase,
} from "./catalog.js";

export interface AnalyzeOptions {
  rules?: AnalysisRule[];
}

export async function analyze(
  config: AnalyzerConfig,
  options?: AnalyzeOptions
): Promise<Diagnostic[]> {
  const rules = options?.rules ?? defaultRules;

  // 1. Resolve file globs to paths
  const stepFilePaths = await globFiles(config.stepFiles);
  const featureFilePaths = await globFiles(config.featureFiles);

  if (stepFilePaths.length === 0) {
    return [];
  }
  if (featureFilePaths.length === 0) {
    return [];
  }

  // 2. Extract step metadata from step files
  const stepDefinitions = extractStepDefinitions(
    stepFilePaths,
    config.tsConfigPath
  );

  // 3. Parse feature files
  const scenarios = parseFeatureFiles(featureFilePaths);

  // 4. For each scenario, match steps and run rules
  const diagnostics: Diagnostic[] = [];
  for (const scenario of scenarios) {
    const matchedSteps = matchScenarioSteps(scenario, stepDefinitions);
    const scenarioDiags = runRules(rules, scenario, matchedSteps);
    diagnostics.push(...scenarioDiags);
  }

  return diagnostics;
}
