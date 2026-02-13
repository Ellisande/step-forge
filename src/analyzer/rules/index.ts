import {
  AnalysisRule,
  Diagnostic,
  MatchedStep,
  ParsedScenario,
} from "../types.js";
import { dependencyRule } from "./dependencyRule.js";
import { undefinedStepRule } from "./undefinedStepRule.js";

export const defaultRules: AnalysisRule[] = [undefinedStepRule, dependencyRule];

export function runRules(
  rules: AnalysisRule[],
  scenario: ParsedScenario,
  matchedSteps: MatchedStep[]
): Diagnostic[] {
  return rules.flatMap((rule) => rule.check(scenario, matchedSteps));
}
