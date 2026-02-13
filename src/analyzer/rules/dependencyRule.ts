import {
  AnalysisRule,
  Diagnostic,
  MatchedStep,
  ParsedScenario,
} from "../types.js";

export const dependencyRule: AnalysisRule = {
  name: "dependency-check",

  check(
    scenario: ParsedScenario,
    matchedSteps: MatchedStep[]
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const produced = {
      given: new Set<string>(),
      when: new Set<string>(),
      then: new Set<string>(),
    };

    for (const step of matchedSteps) {
      if (step.definitions.length !== 1) continue;

      const { dependencies, produces, stepType } = step.definitions[0];

      // Check required dependencies
      for (const phase of ["given", "when", "then"] as const) {
        for (const [key, requirement] of Object.entries(dependencies[phase])) {
          if (requirement === "required" && !produced[phase].has(key)) {
            const available = [...produced[phase]];
            const availableStr =
              available.length > 0 ? available.join(", ") : "(none)";
            diagnostics.push({
              file: scenario.file,
              range: {
                startLine: step.line,
                startColumn: step.column,
                endLine: step.line,
                endColumn: step.column + step.text.length,
              },
              severity: "error",
              message: `Step "${step.text}" requires '${phase}.${key}' but no preceding step produces it. Available ${phase} keys: ${availableStr}. Defined in: ${step.definitions[0].sourceFile}:${step.definitions[0].line}`,
              rule: "dependency-check",
              source: "step-forge",
            });
          }
        }
      }

      // Add produced keys for this step
      for (const key of produces) {
        produced[stepType].add(key);
      }
    }

    return diagnostics;
  },
};
