import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "earl";
import { givenBuilder } from "../../src/given";
import { whenBuilder } from "../../src/when";
import { thenBuilder } from "../../src/then";
import { intParser, stringParser } from "../../src/parsers";
import { analyze } from "../../src/analyzer/index";
import {
  AnalyzerGivenState,
  AnalyzerWhenState,
  AnalyzerThenState,
} from "./analyzerWorld";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../analyzer/fixtures");

// --- Given: point at the fixture files to analyze --- //

givenBuilder<AnalyzerGivenState>()
  .statement((fileName: string) => `step definitions from ${fileName}`)
  .step(({ variables: [fileName] }) => ({
    stepFile: path.join(fixturesDir, fileName),
  }));

givenBuilder<AnalyzerGivenState>()
  .statement((fileName: string) => `a feature file ${fileName}`)
  .step(({ variables: [fileName] }) => ({
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

// --- Then: assert over the produced diagnostics --- //

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .statement("there should be no errors")
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ when: { diagnostics } }) => {
    const errors = diagnostics.filter(d => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .statement((count: number) => `there should be ${count} error/errors`)
  .parsers([intParser])
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ variables: [count], when: { diagnostics } }) => {
    const errors = diagnostics.filter(d => d.severity === "error");
    expect(errors).toHaveLength(count);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .statement((substring: string) => `an error should mention ${substring}`)
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ variables: [substring], when: { diagnostics } }) => {
    const errors = diagnostics.filter(d => d.severity === "error");
    const found = errors.some(e => e.message.includes(substring));
    expect(found).toEqual(true);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .statement(
    (count: number, rule: string) =>
      `there is/are ${count} error/errors for rule ${rule}`
  )
  .parsers([intParser, stringParser])
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ variables: [count, rule], when: { diagnostics } }) => {
    const errors = diagnostics.filter(
      d => d.severity === "error" && d.rule === rule
    );
    expect(errors).toHaveLength(count);
  });

thenBuilder<AnalyzerGivenState, AnalyzerWhenState, AnalyzerThenState>()
  .statement(
    (line: number, startCol: number, endCol: number) =>
      `the error on line ${line} should span columns ${startCol} to ${endCol}`
  )
  .parsers([intParser, intParser, intParser])
  .dependencies({ when: { diagnostics: "required" } })
  .step(({ variables: [line, startCol, endCol], when: { diagnostics } }) => {
    const errors = diagnostics.filter(
      d => d.severity === "error" && d.range.startLine === line
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors[0];
    expect(error.range.startColumn).toEqual(startCol);
    expect(error.range.endColumn).toEqual(endCol);
    expect(error.range.endLine).toEqual(line);
  });
