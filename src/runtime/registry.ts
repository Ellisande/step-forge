/* eslint-disable @typescript-eslint/no-explicit-any */
import { Parser } from "../parsers";
import { MergeableWorld } from "../world";

export type StepType = "given" | "when" | "then";

/**
 * A step definition as it exists at *runtime*, independent of any test runner.
 *
 * `execute` is the fully-wired step body: given a world and the raw values
 * captured from a Gherkin step, it applies parsers, validates + narrows
 * dependencies, runs the user's step function, and merges the result back into
 * the world. The engine never needs to know how any of that works — it just
 * matches text to a step and calls `execute`.
 */
export interface RegisteredStep {
  stepType: StepType;
  /** The Cucumber-expression source, e.g. `a user named {string}`. */
  expression: string;
  /** Parsers, one per captured variable, applied after expression capture. */
  parsers: Parser<any>[];
  execute: (
    world: MergeableWorld<any, any, any>,
    capturedArgs: unknown[]
  ) => Promise<void>;
  /** Where the step was defined, for ambiguous-match diagnostics. */
  source?: string;
}

/**
 * A collection of registered steps. Deliberately a plain instance (not a hidden
 * module global) so tests and the Vitest plugin can create isolated registries.
 * `globalRegistry` is the default sink that `.register()` writes to.
 */
export class StepRegistry {
  private steps: RegisteredStep[] = [];

  add(step: RegisteredStep): void {
    this.steps.push(step);
  }

  all(): readonly RegisteredStep[] {
    return this.steps;
  }

  clear(): void {
    this.steps = [];
  }
}

export const globalRegistry = new StepRegistry();
