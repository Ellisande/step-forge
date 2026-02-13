import {
  AnalysisRule,
  Diagnostic,
  MatchedStep,
  ParsedScenario,
} from "../types.js";

export const ambiguousStepRule: AnalysisRule = {
  name: "ambiguous-step",

  check(
    scenario: ParsedScenario,
    matchedSteps: MatchedStep[]
  ): Diagnostic[] {
    return matchedSteps
      .filter((step) => step.definitions.length > 1)
      .map((step) => {
        const locations = step.definitions
          .map((d) => `${d.sourceFile}:${d.line}`)
          .join(", ");
        return {
          file: scenario.file,
          range: {
            startLine: step.line,
            startColumn: step.column,
            endLine: step.line,
            endColumn: step.column + step.text.length,
          },
          severity: "error" as const,
          message: `Step "${step.text}" matches multiple step definitions: ${locations}`,
          rule: "ambiguous-step",
          source: "step-forge" as const,
        };
      });
  },
};
