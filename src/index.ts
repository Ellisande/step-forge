import { givenBuilder } from "./given";
import { whenBuilder } from "./when";
import { thenBuilder } from "./then";
import { BasicWorld } from "./world";
import {
  stringParser,
  intParser,
  numberParser,
  booleanParser,
  rawTableParser,
  recordsTableParser,
} from "./parsers";
import type { Parser, TableParser } from "./parsers";
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

export {
  givenBuilder,
  whenBuilder,
  thenBuilder,
  BasicWorld,
  stringParser,
  intParser,
  numberParser,
  booleanParser,
  rawTableParser,
  recordsTableParser,
  createBuilders,
};

export type { Parser, TableParser };
export type { StateFromDependencies } from "./typeHelpers";

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
