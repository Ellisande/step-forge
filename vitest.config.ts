import { defineConfig } from "vitest/config";
import { stepForge } from "./src/runtime/vitest";

// Spike: run Gherkin features natively under Vitest, no Cucumber runtime.
export default defineConfig({
  plugins: [
    stepForge({
      steps: ["features/steps/**/*.ts"],
      world: "features/steps/makeWorld.ts",
      features: "features/basic.feature",
    }),
  ],
  test: {
    // Only the feature files are test files here; `include` is augmented by the
    // plugin's config hook to add the `.feature` glob.
    include: [],
  },
});
