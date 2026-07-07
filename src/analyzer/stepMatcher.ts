import {
  CucumberExpression,
  ParameterType,
  ParameterTypeRegistry,
} from "@cucumber/cucumber-expressions";
import { MatchedStep, ParsedScenario, StepDefinitionMeta } from "./types.js";

interface CompiledPattern {
  expression: CucumberExpression;
  definition: StepDefinitionMeta;
}

/** `{name}` tokens in a cucumber expression (empty name is the anonymous `{}`). */
const PARAM_TOKEN = /\{([^}]*)\}/g;

/**
 * Compile each definition's cucumber expression with the **same** engine the
 * runtime uses (`@cucumber/cucumber-expressions`), so the analyzer and the
 * runtime agree on what a step matches.
 *
 * A hand-rolled `{param}` → `(.+)` regex used to stand in here, but it treated
 * cucumber-expression alternative (`a/b`) and optional (`text(s)`) syntax as
 * literal characters — so any step definition using them (e.g.
 * `there should be {int} error/errors`) never matched, and every such step was
 * wrongly reported as an undefined step regardless of the real state.
 *
 * Built-in placeholders (`{int}`, `{float}`, `{string}`, `{word}`) keep their
 * real, strict regexes so the analyzer disambiguates the way the runtime does
 * (e.g. `no` isn't an `{int}`). The analyzer has only the expression string, not
 * a custom parser's regexp, so each custom `{name}` is registered as a permissive
 * parameter type (any value) — lenient about the value's exact shape, but still
 * anchored by the surrounding literal text.
 */
function compileDefinitions(
  definitions: StepDefinitionMeta[]
): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  for (const def of definitions) {
    try {
      const registry = new ParameterTypeRegistry();
      for (const [, name] of def.expression.matchAll(PARAM_TOKEN)) {
        if (!name || registry.lookupByTypeName(name)) continue;
        registry.defineParameterType(
          new ParameterType(name, /.+/, null, (value: string) => value)
        );
      }
      compiled.push({
        expression: new CucumberExpression(def.expression, registry),
        definition: def,
      });
    } catch {
      // Skip definitions whose expression can't be compiled.
    }
  }
  return compiled;
}

export function matchScenarioSteps(
  scenario: ParsedScenario,
  definitions: StepDefinitionMeta[]
): MatchedStep[] {
  const compiled = compileDefinitions(definitions);

  return scenario.steps.map(step => {
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
  for (const { expression, definition } of compiled) {
    if (definition.stepType !== expectedStepType) continue;
    if (expression.match(text) != null) typedMatches.push(definition);
  }

  if (typedMatches.length > 0) return typedMatches;

  // Fallback: match any step type
  const fallbackMatches: StepDefinitionMeta[] = [];
  for (const { expression, definition } of compiled) {
    if (expression.match(text) != null) fallbackMatches.push(definition);
  }

  return fallbackMatches;
}
