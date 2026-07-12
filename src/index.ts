import { givenBuilder } from "./given";
import { whenBuilder } from "./when";
import { thenBuilder } from "./then";
import { BasicWorld } from "./world";
import {
  stringParser,
  intParser,
  numberParser,
  booleanParser,
} from "./parsers";
import type { Parser } from "./parsers";
import {
  analyze,
  extractStepDefinitions,
  parseFeatureFiles,
  parseFeatureContent,
  matchScenarioSteps,
  findMatchingDefinitions,
  defaultRules,
} from "./analyzer/index";
import type {
  AnalyzerConfig,
  AnalyzeOptions,
  AnalysisRule,
  Diagnostic,
  StepDefinitionMeta,
  ParsedScenario,
  ParsedStep,
  MatchedStep,
} from "./analyzer/index";
import { createBuilders } from "./init";
import {
  beforeScenario,
  afterScenario,
  beforeFeature,
  afterFeature,
  beforeAll,
  afterAll,
} from "./hooks";

export {
  givenBuilder,
  whenBuilder,
  thenBuilder,
  BasicWorld,
  stringParser,
  intParser,
  numberParser,
  booleanParser,
  createBuilders,
  beforeScenario,
  afterScenario,
  beforeFeature,
  afterFeature,
  beforeAll,
  afterAll,
};

export type { Parser };
export type {
  ScenarioInfo,
  PlainHookFn,
  ScenarioHookFn,
} from "./runtime/hooks";
export type { StateFromDependencies } from "./typeHelpers";
// Re-exported from the main entry so consumers can type their
// `step-forge.config.ts` with a plain `@step-forge/step-forge` import.
export type { RunnerOptions, Profile } from "./runtime/config";

export const analyzer = {
  analyze,
  extractStepDefinitions,
  parseFeatureFiles,
  parseFeatureContent,
  matchScenarioSteps,
  findMatchingDefinitions,
  defaultRules,
};

export type {
  AnalyzerConfig,
  AnalyzeOptions,
  AnalysisRule,
  Diagnostic,
  StepDefinitionMeta,
  ParsedScenario,
  ParsedStep,
  MatchedStep,
};
