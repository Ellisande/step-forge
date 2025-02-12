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
      formats: ["es"],
      fileName: () => "step-forge.js"
    },
    rollupOptions: {
      external: Object.keys(packageJson.dependencies || {})
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
