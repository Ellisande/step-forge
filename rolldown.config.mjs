import { defineConfig } from "rolldown";

export default defineConfig({
  input: "./src/index.ts",
  output: {
    file: "./build/dist/step-forge.js",
    format: "esm",
    sourcemap: true,
  },
  external: ["@cucumber/cucumber", "lodash"],
});
