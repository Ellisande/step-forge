import { glob } from "node:fs/promises";
import * as path from "node:path";
import { parseFeatureContent } from "../analyzer/gherkinParser";

export interface StepForgeOptions {
  /**
   * Globs (relative to the Vite root) for step-definition modules.
   * Defaults to `**​/*.steps.ts`.
   */
  steps?: string | string[];
  /**
   * Module that default-exports a world factory `() => world`, resolved
   * relative to the Vite root. When omitted, each scenario gets a fresh
   * `BasicWorld`.
   */
  world?: string;
  /** Feature-file glob to register as test files. Defaults to `**​/*.feature`. */
  features?: string;
  /**
   * Advanced: module specifier the generated tests import the runtime from.
   * Defaults to the published `@step-forge/step-forge/runtime` entry; override
   * only when consuming the library from source (e.g. this repo's own tests).
   */
  runtimeModule?: string;
  /**
   * Advanced: module specifier for the library core (used for the default
   * `BasicWorld`). Defaults to `@step-forge/step-forge`.
   */
  coreModule?: string;
}

/** Minimal Vite plugin shape (avoids a hard dependency on vite's types). */
interface VitePlugin {
  name: string;
  enforce?: "pre" | "post";
  config?: () => unknown;
  configResolved?: (config: { root: string }) => void;
  transform?: (
    code: string,
    id: string
  ) => Promise<{ code: string; map: null } | undefined>;
}

const DEFAULT_STEPS = "**/*.steps.ts";
const DEFAULT_FEATURES = "**/*.feature";
const DEFAULT_RUNTIME_MODULE = "@step-forge/step-forge/runtime";
const DEFAULT_CORE_MODULE = "@step-forge/step-forge";

function toSpecifier(p: string): string {
  // Absolute filesystem paths must be POSIX-style for the generated imports;
  // bare package specifiers are emitted verbatim.
  return path.isAbsolute(p) ? p.split(path.sep).join("/") : p;
}

async function resolveSteps(
  steps: string | string[],
  root: string
): Promise<string[]> {
  const patterns = Array.isArray(steps) ? steps : [steps];
  const files = new Set<string>();
  for (const pattern of patterns) {
    for await (const file of glob(pattern, { cwd: root })) {
      files.add(path.resolve(root, file));
    }
  }
  return [...files];
}

/**
 * Vite/Vitest plugin: compiles each `.feature` file into a test module so
 * scenarios show up as native Vitest tests (watch mode, --ui, per-scenario
 * tasks, the lot). The transform injects imports of the step modules so that
 * (a) steps self-register into the same registry the engine reads, and
 * (b) Vite's HMR graph invalidates the feature test when a step file changes.
 */
export function stepForge(options: StepForgeOptions = {}): VitePlugin {
  const featuresGlob = options.features ?? DEFAULT_FEATURES;
  const stepsGlob = options.steps ?? DEFAULT_STEPS;
  const runtimeModule = options.runtimeModule ?? DEFAULT_RUNTIME_MODULE;
  const coreModule = options.coreModule ?? DEFAULT_CORE_MODULE;
  let root = process.cwd();

  return {
    name: "step-forge",
    enforce: "pre",
    config() {
      return { test: { include: [featuresGlob] } };
    },
    configResolved(config) {
      root = config.root;
    },
    async transform(code, id) {
      if (!id.endsWith(".feature")) return;

      const scenarios = parseFeatureContent(code, id);
      const featureName =
        /^\s*Feature:\s*(.+)$/m.exec(code)?.[1]?.trim() ?? path.basename(id);
      const stepFiles = await resolveSteps(stepsGlob, root);

      const stepImports = stepFiles
        .map(f => `import ${JSON.stringify(toSpecifier(f))};`)
        .join("\n");

      // World factory: an explicit `world` module, or a fresh BasicWorld.
      const worldImport = options.world
        ? `import __makeWorld from ${JSON.stringify(
            toSpecifier(path.resolve(root, options.world))
          )};`
        : `import { BasicWorld } from ${JSON.stringify(coreModule)};\n` +
          `const __makeWorld = () => new BasicWorld();`;

      const tests = scenarios
        .map(
          (s, i) =>
            `  test(${JSON.stringify(s.name)}, () => ` +
            `runScenario(__scenarios[${i}], globalRegistry, __makeWorld));`
        )
        .join("\n");

      const generated = `
import { describe, test } from "vitest";
import { runScenario, globalRegistry } from ${JSON.stringify(runtimeModule)};
${worldImport}
${stepImports}

const __scenarios = ${JSON.stringify(scenarios)};

describe(${JSON.stringify(featureName)}, () => {
${tests}
});
`;
      return { code: generated, map: null };
    },
  };
}

/**
 * One-line Vitest config preset. Drop this in `vitest.config.ts`:
 *
 * ```ts
 * import { defineStepForgeConfig } from "@step-forge/step-forge/vitest";
 * export default defineStepForgeConfig({ world: "./support/world.ts" });
 * ```
 *
 * Runs `**​/*.feature` as native tests, auto-discovers `**​/*.steps.ts`, and
 * defaults the world to `BasicWorld`. Override any Vitest option via `test`.
 */
export function defineStepForgeConfig(
  options: StepForgeOptions & { test?: Record<string, unknown> } = {}
) {
  const { test, ...pluginOptions } = options;
  const featuresGlob = pluginOptions.features ?? DEFAULT_FEATURES;
  return {
    plugins: [stepForge(pluginOptions)],
    test: { include: [featuresGlob], ...test },
  };
}
