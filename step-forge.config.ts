import type { RunnerOptions } from "./src/runtime/config";

/**
 * Config for the native Step Forge runner (`bun src/runtime/cli.ts`, aka
 * `npm run test:features`). `features` is a list of **exact** files so the
 * analyzer's `fixtures/*.feature` — which are *inputs* to `analyze()`, not tests
 * — are never discovered as scenarios.
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
