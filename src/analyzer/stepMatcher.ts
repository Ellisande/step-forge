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
    const matches = findMatches(step.text, step.effectiveKeyword, compiled);
    return {
      ...step,
      definitions: matches,
    };
  });
}

function findMatches(
  text: string,
  effectiveKeyword: "Given" | "When" | "Then",
  compiled: CompiledExpression[]
): StepDefinitionMeta[] {
  const keywordToStepType: Record<string, string> = {
    Given: "given",
    When: "when",
    Then: "then",
  };
  const expectedStepType = keywordToStepType[effectiveKeyword];

  // First try to match with the correct step type
  const typedMatches: StepDefinitionMeta[] = [];
  for (const { expression, definition } of compiled) {
    if (definition.stepType !== expectedStepType) continue;
    const result = expression.match(text);
    if (result) typedMatches.push(definition);
  }

  if (typedMatches.length > 0) return typedMatches;

  // Fallback: match any step type (Cucumber itself doesn't enforce keyword-to-step-type)
  const fallbackMatches: StepDefinitionMeta[] = [];
  for (const { expression, definition } of compiled) {
    const result = expression.match(text);
    if (result) fallbackMatches.push(definition);
  }

  return fallbackMatches;
}
