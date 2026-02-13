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

      // Collect all missing required dependencies for this step
      const missing: Record<string, string[]> = {};
      for (const phase of ["given", "when", "then"] as const) {
        for (const [key, requirement] of Object.entries(dependencies[phase])) {
          if (requirement === "required" && !produced[phase].has(key)) {
            if (!missing[phase]) {
              missing[phase] = [];
            }
            missing[phase].push(key);
          }
        }
      }

      if (Object.keys(missing).length > 0) {
        const lines = Object.entries(missing).map(
          ([phase, keys]) =>
            `${phase.charAt(0).toUpperCase() + phase.slice(1)}: ${keys.map((k) => `${phase}.${k}`).join(", ")}`
        );
        const message =
          "Missing required dependencies:\n" + lines.join("\n");

        diagnostics.push({
          file: scenario.file,
          range: {
            startLine: step.line,
            startColumn: step.column,
            endLine: step.line,
            endColumn: step.column + step.text.length,
          },
          severity: "error",
          message,
          rule: "dependency-check",
          source: "step-forge",
        });
      }

      // Add produced keys for this step
      for (const key of produces) {
        produced[stepType].add(key);
      }
    }

    return diagnostics;
  },
};
