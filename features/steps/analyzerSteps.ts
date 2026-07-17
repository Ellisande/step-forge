import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "earl";
import { givenBuilder } from "../../src/given";
import { whenBuilder } from "../../src/when";
import { thenBuilder } from "../../src/then";
import { intParser, stringParser } from "../../src/parsers";
import { analyze, buildCatalog, filterCatalog } from "../../src/analyzer/index";
import {
  AnalyzerGivenState,
  AnalyzerWhenState,
  AnalyzerThenState,
} from "./analyzerWorld";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../analyzer/fixtures");

// --- Given: point at the fixture files to analyze --- //

givenBuilder<AnalyzerGivenState>()
  .variables({ fileName: stringParser })
  .statement(v => `step definitions from ${v.fileName}`)
  .step(({ variables: { fileName } }) => ({
    stepFile: path.join(fixturesDir, fileName),
  }));

givenBuilder<AnalyzerGivenState>()
  .variables({ fileName: stringParser })
  .statement(v => `a feature file ${v.fileName}`)
  .step(({ variables: { fileName } }) => ({
    featureFile: path.join(fixturesDir, fileName),
  }));

// --- When: run the analyzer over the recorded fixtures --- //

whenBuilder<AnalyzerGivenState, AnalyzerWhenState>()
  .statement("I analyze the files")
  .dependencies({ given: { stepFile: "required", featureFile: "required" } })
  .step(async ({ given: { stepFile, featureFile } }) => ({
    diagnostics: await analyze({
      stepFiles: [stepFile],
      featureFiles: [featureFile],
    }),
  }));

whenBuilder<AnalyzerGivenState, AnalyzerWhenState>()
  .statement("I build the step catalog")
  .dependencies({ given: { stepFile: "required" } })
  .step(async ({ given: { stepFile } }) => ({
    catalog: await buildCatalog({ stepFiles: [stepFile] }),
  }));

// --- Then: assert over the produced diagnostics --- //

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .statement("there should be no errors")
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ when: { diagnostics } }) => {
    const errors = diagnostics.filter(d => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({ count: intParser })
  .statement(v => `there should be ${v.count} error/errors`)
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ variables: { count }, when: { diagnostics } }) => {
    const errors = diagnostics.filter(d => d.severity === "error");
    expect(errors).toHaveLength(count);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({ substring: stringParser })
  .statement(v => `an error should mention ${v.substring}`)
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ variables: { substring }, when: { diagnostics } }) => {
    const errors = diagnostics.filter(d => d.severity === "error");
    const found = errors.some(e => e.message.includes(substring));
    expect(found).toEqual(true);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({ count: intParser, rule: stringParser })
  .statement(v => `there is/are ${v.count} error/errors for rule ${v.rule}`)
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ variables: { count, rule }, when: { diagnostics } }) => {
    const errors = diagnostics.filter(
      d => d.severity === "error" && d.rule === rule
    );
    expect(errors).toHaveLength(count);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({ line: intParser, startCol: intParser, endCol: intParser })
  .statement(
    v =>
      `the error on line ${v.line} should span columns ${v.startCol} to ${v.endCol}`
  )
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ variables: { line, startCol, endCol }, when: { diagnostics } }) => {
    const errors = diagnostics.filter(
      d => d.severity === "error" && d.range.startLine === line
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors[0];
    expect(error.range.startColumn).toEqual(startCol);
    expect(error.range.endColumn).toEqual(endCol);
    expect(error.range.endLine).toEqual(line);
  });

// --- Then: assert over the built catalog --- //

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({ stepType: stringParser, expression: stringParser })
  .statement(v => `the catalog contains a ${v.stepType} step ${v.expression}`)
  .dependencies({ when: { catalog: "required" } })
  .step(({ variables: { stepType, expression }, when: { catalog } }) => {
    const entry = catalog.steps.find(s => s.expression === expression);
    expect(entry).not.toBeNullish();
    expect(entry?.stepType).toEqual(stepType);
    expect(entry?.id).toEqual(`${entry?.sourceFile}:${entry?.line}`);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({ expression: stringParser, key: stringParser })
  .statement(v => `the catalog step ${v.expression} produces ${v.key}`)
  .dependencies({ when: { catalog: "required" } })
  .step(({ variables: { expression, key }, when: { catalog } }) => {
    const entry = catalog.steps.find(s => s.expression === expression);
    expect(entry).not.toBeNullish();
    expect(entry?.produces ?? []).toInclude(key);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({
    expression: stringParser,
    key: stringParser,
    phase: stringParser,
  })
  .statement(
    v =>
      `the catalog step ${v.expression} requires ${v.key} from ${v.phase} state`
  )
  .dependencies({ when: { catalog: "required" } })
  .step(({ variables: { expression, key, phase }, when: { catalog } }) => {
    const entry = catalog.steps.find(s => s.expression === expression);
    expect(entry).not.toBeNullish();
    const deps = entry?.dependencies[phase as "given" | "when" | "then"];
    expect(deps?.[key]).toEqual("required");
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({ key: stringParser, count: intParser })
  .statement(
    v =>
      `filtering the catalog by consumed key ${v.key} yields ${v.count} step/steps`
  )
  .dependencies({ when: { catalog: "required" } })
  .step(({ variables: { key, count }, when: { catalog } }) => {
    const matches = filterCatalog(catalog.steps, { consumes: { key } });
    expect(matches).toHaveLength(count);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .variables({ key: stringParser, count: intParser })
  .statement(
    v =>
      `filtering the catalog by produced key ${v.key} yields ${v.count} step/steps`
  )
  .dependencies({ when: { catalog: "required" } })
  .step(({ variables: { key, count }, when: { catalog } }) => {
    const matches = filterCatalog(catalog.steps, { produces: key });
    expect(matches).toHaveLength(count);
  });
