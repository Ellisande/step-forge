import * as fs from "node:fs";
import { GherkinClassicTokenMatcher, Parser, AstBuilder } from "@cucumber/gherkin";
import * as messages from "@cucumber/messages";
import { ParsedScenario, ParsedStep } from "./types.js";

type GherkinKeyword = "Given" | "When" | "Then" | "And" | "But";

export function parseFeatureFiles(filePaths: string[]): ParsedScenario[] {
  const scenarios: ParsedScenario[] = [];

  for (const filePath of filePaths) {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFeatureContent(content, filePath);
    scenarios.push(...parsed);
  }

  return scenarios;
}

export function parseFeatureContent(
  content: string,
  filePath: string
): ParsedScenario[] {
  const newId = messages.IdGenerator.uuid();
  const builder = new AstBuilder(newId);
  const matcher = new GherkinClassicTokenMatcher();
  const parser = new Parser(builder, matcher);

  const gherkinDocument: messages.GherkinDocument = parser.parse(content);
  const feature = gherkinDocument.feature;
  if (!feature) return [];

  // Collect background steps at the feature level
  const featureBackground: messages.Step[] = [];
  const scenarios: ParsedScenario[] = [];
  const featureTags = tagNames(feature.tags);

  for (const child of feature.children) {
    if (child.background) {
      featureBackground.push(...child.background.steps);
    }

    if (child.scenario) {
      scenarios.push(
        ...expandScenario(
          child.scenario,
          featureBackground,
          filePath,
          featureTags
        )
      );
    }

    if (child.rule) {
      // Rules can have their own backgrounds and tags, both inherited by the
      // rule's scenarios.
      const ruleBackground: messages.Step[] = [...featureBackground];
      const ruleTags = [...featureTags, ...tagNames(child.rule.tags)];
      for (const ruleChild of child.rule.children) {
        if (ruleChild.background) {
          ruleBackground.push(...ruleChild.background.steps);
        }
        if (ruleChild.scenario) {
          scenarios.push(
            ...expandScenario(
              ruleChild.scenario,
              ruleBackground,
              filePath,
              ruleTags
            )
          );
        }
      }
    }
  }

  return scenarios;
}

/** Extract tag names (each keeping its leading `@`), deduped in order. */
function tagNames(tags: readonly messages.Tag[] | undefined): string[] {
  return [...new Set((tags ?? []).map(t => t.name))];
}

function expandScenario(
  scenario: messages.Scenario,
  backgroundSteps: messages.Step[],
  filePath: string,
  inheritedTags: string[]
): ParsedScenario[] {
  const scenarioTags = [...inheritedTags, ...tagNames(scenario.tags)];
  const hasExamples =
    scenario.examples.length > 0 &&
    scenario.examples.some((e) => e.tableBody.length > 0);

  if (!hasExamples) {
    // Regular scenario
    const bgParsed = convertSteps(backgroundSteps);
    const scenarioParsed = convertSteps(scenario.steps);
    const allSteps = resolveEffectiveKeywords([...bgParsed, ...scenarioParsed]);

    return [
      {
        name: scenario.name,
        file: filePath,
        line: scenario.location.line,
        steps: allSteps,
        tags: scenarioTags,
      },
    ];
  }

  // Scenario Outline — expand with each example row. Rows carry the outline's
  // base name so the runner can group them, plus the Examples-block tags.
  const results: ParsedScenario[] = [];
  for (const example of scenario.examples) {
    if (!example.tableHeader || example.tableBody.length === 0) continue;
    const headers = example.tableHeader.cells.map((c) => c.value);
    const exampleTags = [...scenarioTags, ...tagNames(example.tags)];

    for (const row of example.tableBody) {
      const values = row.cells.map((c) => c.value);
      const substitution: Record<string, string> = {};
      headers.forEach((h, i) => {
        substitution[h] = values[i];
      });

      const bgParsed = convertSteps(backgroundSteps);
      const scenarioSteps = convertSteps(scenario.steps).map((step) => ({
        ...step,
        text: substituteExampleValues(step.text, substitution),
      }));
      const allSteps = resolveEffectiveKeywords([...bgParsed, ...scenarioSteps]);

      results.push({
        name: headers.map((h, i) => `${h}=${values[i]}`).join(", "),
        file: filePath,
        line: row.location.line,
        steps: allSteps,
        tags: exampleTags,
        outline: { name: scenario.name },
      });
    }
  }

  return results;
}

function convertSteps(
  steps: readonly messages.Step[]
): Omit<ParsedStep, "effectiveKeyword">[] {
  return steps.map((step) => ({
    keyword: normalizeKeyword(step.keyword),
    text: step.text,
    line: step.location.line,
    // step.location.column points to the keyword start; shift past the
    // keyword (which includes a trailing space) so column points to the
    // start of the step text. This makes `column + text.length` produce
    // the correct end position for diagnostic ranges.
    column: (step.location.column ?? 1) + step.keyword.length,
  }));
}

function normalizeKeyword(keyword: string): GherkinKeyword {
  const trimmed = keyword.trim();
  // Gherkin keywords may include trailing space, e.g. "Given "
  if (trimmed === "Given") return "Given";
  if (trimmed === "When") return "When";
  if (trimmed === "Then") return "Then";
  if (trimmed === "And") return "And";
  if (trimmed === "But") return "But";
  // Fallback: treat as Given (shouldn't happen with valid Gherkin)
  return "Given";
}

function resolveEffectiveKeywords(
  steps: Omit<ParsedStep, "effectiveKeyword">[]
): ParsedStep[] {
  let lastEffective: "Given" | "When" | "Then" = "Given";

  return steps.map((step) => {
    let effectiveKeyword: "Given" | "When" | "Then";
    if (step.keyword === "And" || step.keyword === "But") {
      effectiveKeyword = lastEffective;
    } else {
      effectiveKeyword = step.keyword as "Given" | "When" | "Then";
    }
    lastEffective = effectiveKeyword;

    return {
      ...step,
      effectiveKeyword,
    };
  });
}

function substituteExampleValues(
  text: string,
  substitution: Record<string, string>
): string {
  let result = text;
  for (const [key, value] of Object.entries(substitution)) {
    result = result.replace(new RegExp(`<${key}>`, "g"), value);
  }
  return result;
}
