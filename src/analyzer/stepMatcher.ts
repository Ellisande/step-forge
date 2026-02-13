import {
  CucumberExpression,
  ParameterTypeRegistry,
} from "@cucumber/cucumber-expressions";
import { MatchedStep, ParsedScenario, StepDefinitionMeta } from "./types.js";

interface CompiledExpression {
  expression: CucumberExpression;
  definition: StepDefinitionMeta;
}

export function matchScenarioSteps(
  scenario: ParsedScenario,
  definitions: StepDefinitionMeta[]
): MatchedStep[] {
  const registry = new ParameterTypeRegistry();

  const compiled: CompiledExpression[] = [];
  for (const def of definitions) {
    try {
      const expression = new CucumberExpression(def.expression, registry);
      compiled.push({ expression, definition: def });
    } catch {
      // Skip definitions with invalid expressions
    }
  }

  return scenario.steps.map((step) => {
    const match = findMatch(step.text, step.effectiveKeyword, compiled);
    return {
      ...step,
      definition: match,
    };
  });
}

function findMatch(
  text: string,
  effectiveKeyword: "Given" | "When" | "Then",
  compiled: CompiledExpression[]
): StepDefinitionMeta | null {
  const keywordToStepType: Record<string, string> = {
    Given: "given",
    When: "when",
    Then: "then",
  };
  const expectedStepType = keywordToStepType[effectiveKeyword];

  // First try to match with the correct step type
  for (const { expression, definition } of compiled) {
    if (definition.stepType !== expectedStepType) continue;
    const result = expression.match(text);
    if (result) return definition;
  }

  // Fallback: match any step type (Cucumber itself doesn't enforce keyword-to-step-type)
  for (const { expression, definition } of compiled) {
    const result = expression.match(text);
    if (result) return definition;
  }

  return null;
}
