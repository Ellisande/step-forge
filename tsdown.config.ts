import { defineConfig } from "tsdown";

// `dependencies` and `peerDependencies` (the @cucumber/* packages, lodash, and
// typescript) plus `node:` builtins are externalized automatically by tsdown,
// so no explicit external list is needed.
const shared = {
  outDir: "./build/dist",
  platform: "node" as const,
  sourcemap: true,
  dts: true,
  // Follow the package's "type": "module" for extensions: ESM -> .js/.d.ts,
  // CJS -> .cjs/.d.cts. Without this, tsdown emits .mjs for the ESM build.
  fixedExtension: false,
  // `rm -rf build` in the npm script does the cleaning; disabling clean here
  // prevents the second config below from wiping the first config's output.
  clean: false,
};

export default defineConfig([
  // Main entry + runtime: ESM + CJS, with bundled type declarations. These two
  // share a build so the step registry is emitted as a single shared chunk —
  // the builders (main entry) and `runScenario` (runtime) must see the *same*
  // `globalRegistry` instance, or registered steps won't be visible at run time.
  {
    ...shared,
    entry: {
      "step-forge": "./src/index.ts",
      runtime: "./src/runtime/index.ts",
    },
    format: ["esm", "cjs"],
  },
  // Analyzer library + CLI and the Vitest plugin: ESM only. Shared code is
  // split into a chunk.
  {
    ...shared,
    entry: {
      analyzer: "./src/analyzer/index.ts",
      "analyzer-cli": "./src/analyzer/cli.ts",
      vitest: "./src/runtime/vitest.ts",
    },
    format: ["esm"],
  },
]);
