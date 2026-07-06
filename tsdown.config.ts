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
  // Main entry + runtime + CLI: ESM + CJS, with bundled type declarations. These
  // share one build so the step registry is emitted as a single shared chunk —
  // the builders (main entry), `runScenario` (runtime), and the `step-forge` CLI
  // must all see the *same* `globalRegistry` instance, or steps a consumer
  // registers by importing `@step-forge/step-forge` won't be visible when the
  // CLI runs them. Splitting the CLI into its own group would bundle a second
  // registry and silently break registration.
  {
    ...shared,
    entry: {
      "step-forge": "./src/index.ts",
      runtime: "./src/runtime/index.ts",
      cli: "./src/runtime/cli.ts",
    },
    format: ["esm", "cjs"],
  },
  // Analyzer library + CLI: ESM only. Shared code is split into a chunk.
  {
    ...shared,
    entry: {
      analyzer: "./src/analyzer/index.ts",
      "analyzer-cli": "./src/analyzer/cli.ts",
    },
    format: ["esm"],
  },
]);
