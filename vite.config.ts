/// <reference types="vitest" />
import path from "path";
import { defineConfig } from "vite";
import packageJson from "./package.json";

const getPackageName = () => {
  return packageJson.name;
};

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "step-forge",
      formats: ["es", "cjs"],
      fileName: (format) => `step-forge.${format === "es" ? "js" : "cjs"}`
    },
    rollupOptions: {
      external: Object.keys(packageJson.dependencies || {}),
      output: {
        format: "cjs",
        exports: "named",
        interop: "auto"
      }
    }
  },
  test: {
    watch: false,
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      { find: "@@", replacement: path.resolve(__dirname) },
    ],
  },
});
