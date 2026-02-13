import { MatchedStep, ParsedScenario, StepDefinitionMeta } from "./types.js";

interface CompiledPattern {
  regex: RegExp;
  definition: StepDefinitionMeta;
}

function compileDefinitions(
  definitions: StepDefinitionMeta[]
): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  for (const def of definitions) {
    try {
      // Replace {paramType} placeholders with (.+) to match any value,
      // matching the Step Forge runtime behavior where all params use {string}
      // and values are coerced at runtime via typeCoercer.
      const placeholder = "###PLACEHOLDER###";
      const regexStr = def.expression
        .replace(/\{[^}]+\}/g, placeholder)
        .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
        .replace(new RegExp(placeholder, "g"), "(.+)");
      compiled.push({
        regex: new RegExp(`^${regexStr}$`, "i"),
        definition: def,
      });
    } catch {
      // Skip definitions with invalid expressions
    }
  }
  return compiled;
}

export function matchScenarioSteps(
  scenario: ParsedScenario,
  definitions: StepDefinitionMeta[]
): MatchedStep[] {
  const compiled = compileDefinitions(definitions);

  return scenario.steps.map((step) => {
    const matches = findMatches(step.text, step.effectiveKeyword, compiled);
    return {
      ...step,
      definitions: matches,
    };
  });
}

export function findMatchingDefinitions(
  text: string,
  effectiveKeyword: "Given" | "When" | "Then",
  definitions: StepDefinitionMeta[]
): StepDefinitionMeta[] {
  const compiled = compileDefinitions(definitions);
  return findMatches(text, effectiveKeyword, compiled);
}

function findMatches(
  text: string,
  effectiveKeyword: "Given" | "When" | "Then",
  compiled: CompiledPattern[]
): StepDefinitionMeta[] {
  const keywordToStepType: Record<string, string> = {
    Given: "given",
    When: "when",
    Then: "then",
  };
  const expectedStepType = keywordToStepType[effectiveKeyword];

  // First try to match with the correct step type
  const typedMatches: StepDefinitionMeta[] = [];
  for (const { regex, definition } of compiled) {
    if (definition.stepType !== expectedStepType) continue;
    if (regex.test(text)) typedMatches.push(definition);
  }

  if (typedMatches.length > 0) return typedMatches;

  // Fallback: match any step type
  const fallbackMatches: StepDefinitionMeta[] = [];
  for (const { regex, definition } of compiled) {
    if (regex.test(text)) fallbackMatches.push(definition);
  }

  return fallbackMatches;
}
