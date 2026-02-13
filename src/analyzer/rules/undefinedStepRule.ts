import {
  AnalysisRule,
  Diagnostic,
  MatchedStep,
  ParsedScenario,
} from "../types.js";

export const undefinedStepRule: AnalysisRule = {
  name: "undefined-step",

  check(
    scenario: ParsedScenario,
    matchedSteps: MatchedStep[]
  ): Diagnostic[] {
    return matchedSteps
      .filter((step) => step.definitions.length === 0)
      .map((step) => ({
        file: scenario.file,
        range: {
          startLine: step.line,
          startColumn: step.column,
          endLine: step.line,
          endColumn: step.column + step.text.length,
        },
        severity: "error" as const,
        message: `Step "${step.text}" does not match any step definition`,
        rule: "undefined-step",
        source: "step-forge" as const,
      }));
  },
};
