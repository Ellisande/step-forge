import { glob } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeatureContent } from "../analyzer/gherkinParser";

export interface StepForgeOptions {
  /** Globs (relative to the Vite root) for step-definition modules. */
  steps: string | string[];
  /**
   * Module that default-exports a world factory `() => world`. Each scenario
   * gets a fresh world from it.
   */
  world: string;
  /** Feature-file glob to register as test files. Defaults to all `.feature`. */
  features?: string;
}

/** Minimal Vite plugin shape (avoids a hard dependency on vite's types). */
interface VitePlugin {
  name: string;
  enforce?: "pre" | "post";
  config?: () => unknown;
  transform?: (
    code: string,
    id: string
  ) => Promise<{ code: string; map: null } | undefined>;
}

const runtimeDir = fileURLToPath(new URL(".", import.meta.url));
const enginePath = path.join(runtimeDir, "engine.ts");
const registryPath = path.join(runtimeDir, "registry.ts");

function toImport(p: string): string {
  return JSON.stringify(p.split(path.sep).join("/"));
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
export function stepForge(options: StepForgeOptions): VitePlugin {
  const featuresGlob = options.features ?? "**/*.feature";
  let root = process.cwd();

  return {
    name: "step-forge",
    enforce: "pre",
    config() {
      return { test: { include: [featuresGlob] } };
    },
    async transform(code, id) {
      if (!id.endsWith(".feature")) return;

      const scenarios = parseFeatureContent(code, id);
      const featureName =
        /^\s*Feature:\s*(.+)$/m.exec(code)?.[1]?.trim() ?? path.basename(id);
      const stepFiles = await resolveSteps(options.steps, root);
      const worldModule = path.resolve(root, options.world);

      const stepImports = stepFiles
        .map(f => `import ${toImport(f)};`)
        .join("\n");

      const tests = scenarios
        .map(
          (s, i) =>
            `  test(${JSON.stringify(s.name)}, () => ` +
            `runScenario(__scenarios[${i}], globalRegistry, __makeWorld));`
        )
        .join("\n");

      const generated = `
import { describe, test } from "vitest";
import { runScenario } from ${toImport(enginePath)};
import { globalRegistry } from ${toImport(registryPath)};
import __makeWorld from ${toImport(worldModule)};
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
