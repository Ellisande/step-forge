import { defineConfig } from "rolldown";

export default defineConfig([
  {
    input: "./src/index.ts",
    output: {
      file: "./build/dist/step-forge.js",
      format: "esm",
      sourcemap: true,
    },
    external: ["@cucumber/cucumber", "lodash"],
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
    external: [
      "@cucumber/cucumber",
      "@cucumber/gherkin",
      "@cucumber/messages",
      "@cucumber/cucumber-expressions",
      "lodash",
      "typescript",
      /^node:/,
    ],
  },
]);
