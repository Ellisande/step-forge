import {
  CucumberExpression,
  ParameterType,
  ParameterTypeRegistry,
} from "@cucumber/cucumber-expressions";
import {
  booleanParser,
  intParser,
  numberParser,
  stringParser,
} from "../parsers.js";
import { MatchedStep, ParsedScenario, StepDefinitionMeta } from "./types.js";

interface CompiledPattern {
  expression: CucumberExpression;
  definition: StepDefinitionMeta;
}

/** The library's builtin parsers, the same set the runtime engine registers. */
const BUILTIN_PARSERS = [stringParser, intParser, numberParser, booleanParser];

const PLACEHOLDER_RE = /\{([^}]*)\}/g;

/**
 * Compile a step expression exactly the way the runtime engine does
 * (`compileRegistry` in src/runtime/engine.ts): a per-definition
 * `ParameterTypeRegistry` seeded with cucumber's builtins, the library's own
 * builtin parsers, and the definition's extracted custom-parser patterns
 * (`def.parameters`). Matching semantics — optional text `(s)`, alternation
 * `a/b`, case sensitivity, what each placeholder accepts — therefore agree
 * with the runtime by construction instead of by a hand-rolled regex
 * translation. A placeholder the extractor couldn't resolve gets a
 * match-anything parameter type as the last resort.
 */
function compileExpression(def: StepDefinitionMeta): CucumberExpression {
  const registry = new ParameterTypeRegistry();
  const define = (name: string, regexps: RegExp[] | string[] | string) => {
    if (registry.lookupByTypeName(name)) return;
    registry.defineParameterType(
      new ParameterType(name, regexps, null, (value: string) => value)
    );
  };
  for (const parser of BUILTIN_PARSERS) {
    define(
      parser.name,
      Array.isArray(parser.regexp) ? parser.regexp : [parser.regexp]
    );
  }
  for (const [name, pattern] of Object.entries(def.parameters ?? {})) {
    define(name, pattern);
  }
  // Any placeholder still unknown (an unresolvable custom parser) matches any
  // text rather than failing compilation — "don't know" must not become a
  // false undefined-step diagnostic.
  for (const [, name] of def.expression.matchAll(PLACEHOLDER_RE)) {
    if (name) define(name, ".+");
  }
  return new CucumberExpression(def.expression, registry);
}

function compileDefinitions(
  definitions: StepDefinitionMeta[]
): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  for (const definition of definitions) {
    try {
      compiled.push({ expression: compileExpression(definition), definition });
    } catch {
      // Skip definitions with invalid expressions
    }
  }
  return compiled;
}

/**
 * Compilation memoized on the definitions array's identity: `analyze()` calls
 * `matchScenarioSteps` once per scenario with the same array, so every
 * scenario after the first reuses the compiled expressions.
 */
const compiledCache = new WeakMap<StepDefinitionMeta[], CompiledPattern[]>();
function compiledFor(definitions: StepDefinitionMeta[]): CompiledPattern[] {
  let compiled = compiledCache.get(definitions);
  if (!compiled) {
    compiled = compileDefinitions(definitions);
    compiledCache.set(definitions, compiled);
  }
  return compiled;
}

export function matchScenarioSteps(
  scenario: ParsedScenario,
  definitions: StepDefinitionMeta[]
): MatchedStep[] {
  const compiled = compiledFor(definitions);

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
  return findMatches(text, effectiveKeyword, compiledFor(definitions));
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
    if (expression.match(text)) typedMatches.push(definition);
  }

  if (typedMatches.length > 0) return typedMatches;

  // Fallback: match any step type
  const fallbackMatches: StepDefinitionMeta[] = [];
  for (const { expression, definition } of compiled) {
    if (expression.match(text)) fallbackMatches.push(definition);
  }

  return fallbackMatches;
}
