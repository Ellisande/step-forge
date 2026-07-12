import { Diagnostic } from "../../src/analyzer/index";

/**
 * World-state contract for the analyzer self-tests. State flows through the
 * dependency graph (the source of truth) exactly like any other Step Forge
 * scenario: the two `Given`s record which fixture files to analyze, the `When`
 * runs `analyze()` and produces the diagnostics, and every `Then` reads them.
 */
export interface AnalyzerGivenState {
  stepFile: string;
  featureFile: string;
}

export interface AnalyzerWhenState {
  diagnostics: Diagnostic[];
}

export type AnalyzerThenState = Record<string, never>;
