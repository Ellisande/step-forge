import type { RunnerOptions } from "./src/runtime/config";

/**
 * Config for the native Step Forge runner (`bun src/runtime/cli.ts`). Mirrors
 * the `vitest.config.ts` wiring: the same exact feature files (so the analyzer's
 * `fixtures/*.feature`, which are *inputs* to `analyze()`, aren't run as tests)
 * and the same step + world modules.
 */
const config: RunnerOptions = {
  steps: ["features/steps/commonSteps.ts", "features/steps/analyzerSteps.ts"],
  world: "features/steps/makeWorld.ts",
  features: [
    "features/basic.feature",
    "features/tags.feature",
    "features/analyzer/analyzer.feature",
  ],
};

export default config;
