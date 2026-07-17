export interface StepDefinitionMeta {
  stepType: "given" | "when" | "then";
  expression: string;
  dependencies: {
    given: Record<string, "required" | "optional">;
    when: Record<string, "required" | "optional">;
    then: Record<string, "required" | "optional">;
  };
  produces: string[];
  sourceFile: string;
  line: number;
  /**
   * Regex source per custom placeholder used in `expression` (e.g.
   * `{ color: "red|green|blue" }`), extracted from the parser declaration's
   * `regexp` property when it is statically visible. The matcher uses these to
   * constrain matching exactly like the runtime engine; built-in placeholders
   * (`{string}`/`{int}`/`{float}`/`{boolean}`) don't need an entry, and a
   * custom placeholder without one falls back to matching any text.
   */
  parameters?: Record<string, string>;
}

export interface ParsedScenario {
  name: string;
  file: string;
  /** 1-based line of the `Scenario:`/`Scenario Outline:` keyword in the file. */
  line?: number;
  steps: ParsedStep[];
  /**
   * Gherkin tags in effect for this scenario, each including the leading `@`
   * (feature + scenario tags, plus the Examples-block tags for outline rows).
   * The Vitest plugin maps `@skip`/`@only` onto `test.skip`/`test.only`.
   */
  tags: string[];
  /**
   * Present only for rows expanded from a multi-row `Scenario Outline`. Carries
   * the base outline name so the plugin can group its rows under one `describe`,
   * with each row a separate `test` labelled by its example values. A single-row
   * outline is collapsed to a plain scenario (named after the outline) and omits
   * this marker, since it runs exactly once.
   */
  outline?: { name: string };
}

export interface ParsedStep {
  keyword: "Given" | "When" | "Then" | "And" | "But";
  effectiveKeyword: "Given" | "When" | "Then";
  text: string;
  line: number;
  column: number;
}

export interface MatchedStep extends ParsedStep {
  definitions: StepDefinitionMeta[];
}

export interface Diagnostic {
  file: string;
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  severity: "error" | "warning" | "info";
  message: string;
  rule: string;
  source: "step-forge";
}

export interface AnalysisRule {
  name: string;
  check(scenario: ParsedScenario, matchedSteps: MatchedStep[]): Diagnostic[];
}

export interface AnalyzerConfig {
  stepFiles: string[];
  featureFiles: string[];
  tsConfigPath?: string;
}
