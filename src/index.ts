import { givenBuilder } from "./given";
import { whenBuilder } from "./when";
import { thenBuilder } from "./then";
import { BasicWorld } from "./world";
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

export { givenBuilder, whenBuilder, thenBuilder, BasicWorld };

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
