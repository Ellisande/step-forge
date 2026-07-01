import { fileURLToPath } from "node:url";
import { defineStepForgeConfig } from "./src/runtime/vitest";

// This repo consumes the library from source, so point the generated tests at
// the runtime source module rather than the published `@step-forge/step-forge/
// runtime` entry. Consumers never need this override.
const runtimeModule = fileURLToPath(
  new URL("./src/runtime/index.ts", import.meta.url)
);

export default defineStepForgeConfig({
  steps: ["features/steps/commonSteps.ts", "features/steps/analyzerSteps.ts"],
  world: "features/steps/makeWorld.ts",
  // Exact files, so the analyzer's own `fixtures/*.feature` (which are *inputs*
  // to `analyze()`, not tests) are never picked up as scenarios.
  features: ["features/basic.feature", "features/analyzer/analyzer.feature"],
  runtimeModule,
});
