import { defineConfig } from "rolldown";

const allExternal = [
  "@cucumber/cucumber",
  "@cucumber/gherkin",
  "@cucumber/messages",
  "@cucumber/cucumber-expressions",
  "lodash",
  "typescript",
  /^node:/,
];

export default defineConfig([
  {
    input: "./src/index.ts",
    output: {
      file: "./build/dist/step-forge.js",
      format: "esm",
      sourcemap: true,
    },
    external: allExternal,
  },
  {
    input: "./src/index.ts",
    output: {
      file: "./build/dist/step-forge.cjs",
      format: "cjs",
      sourcemap: true,
    },
    external: allExternal,
  },
  {
    input: {
      analyzer: "./src/analyzer/index.ts",
      "analyzer-cli": "./src/analyzer/cli.ts",
    },
    output: {
      dir: "./build/dist",
      format: "esm",
      sourcemap: true,
      entryFileNames: "[name].js",
    },
    external: allExternal,
  },
]);
