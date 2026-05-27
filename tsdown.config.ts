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
  // Main entry: ESM + CJS, with bundled type declarations (.d.ts / .d.cts).
  {
    ...shared,
    entry: { "step-forge": "./src/index.ts" },
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
