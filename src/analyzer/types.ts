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
}

export interface ParsedScenario {
  name: string;
  file: string;
  steps: ParsedStep[];
}

export interface ParsedStep {
  keyword: "Given" | "When" | "Then" | "And" | "But";
  effectiveKeyword: "Given" | "When" | "Then";
  text: string;
  line: number;
  column: number;
}

export interface MatchedStep extends ParsedStep {
  definition: StepDefinitionMeta | null;
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
