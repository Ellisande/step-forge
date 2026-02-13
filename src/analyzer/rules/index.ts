import {
  AnalysisRule,
  Diagnostic,
  MatchedStep,
  ParsedScenario,
} from "../types.js";
import { dependencyRule } from "./dependencyRule.js";

export const defaultRules: AnalysisRule[] = [dependencyRule];

export function runRules(
  rules: AnalysisRule[],
  scenario: ParsedScenario,
  matchedSteps: MatchedStep[]
): Diagnostic[] {
  return rules.flatMap((rule) => rule.check(scenario, matchedSteps));
}
