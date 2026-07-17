import { MatchedStep, ParsedScenario, StepDefinitionMeta } from "./types.js";

interface CompiledPattern {
  regex: RegExp;
  definition: StepDefinitionMeta;
}

/**
 * What each built-in placeholder actually matches, mirroring the runtime
 * engine's parameter types: `{string}` is a quoted value (escapes allowed),
 * `{int}`/`{float}` are numeric, `{boolean}` is `true`/`false`. Equivalent to
 * the `src/parsers.ts` regexps; the matcher unit tests pin the behavior.
 */
const BUILTIN_PLACEHOLDER_PATTERNS: Record<string, string> = {
  string: `"[^"\\\\]*(?:\\\\.[^"\\\\]*)*"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*'`,
  int: "-?\\d+",
  float: "-?\\d*\\.?\\d+",
  boolean: "true|false",
};

/**
 * Compile a step expression into an anchored, case-sensitive regex whose
 * placeholders match by their real syntax: the extracted parser pattern for a
 * custom placeholder (`def.parameters`), the built-in pattern for
 * `{string}`/`{int}`/`{float}`/`{boolean}`, and `.+` only as the last resort
 * for a placeholder the extractor couldn't resolve. This is what lets the
 * analyzer catch a step whose text can't actually satisfy its parsers (e.g.
 * `I deposit ten` against `I deposit {int}`) instead of silently matching.
 */
function compileExpression(def: StepDefinitionMeta): RegExp {
  const parts = def.expression.split(/(\{[^}]*\})/);
  let regexStr = "";
  for (const part of parts) {
    const placeholder = /^\{([^}]*)\}$/.exec(part);
    if (placeholder) {
      const name = placeholder[1];
      const pattern =
        def.parameters?.[name] ?? BUILTIN_PLACEHOLDER_PATTERNS[name] ?? ".+";
      regexStr += `(${pattern})`;
    } else {
      regexStr += part.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regexStr}$`);
}

function compileDefinitions(
  definitions: StepDefinitionMeta[]
): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  for (const def of definitions) {
    try {
      compiled.push({
        regex: compileExpression(def),
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
