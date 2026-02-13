const config = {
  compilationOptions: {
    preferredConfigPath: "./tsconfig.json",
  },
  entries: [
    {
      filePath: "./src/index.ts",
      outFile: "./build/dist/index.d.ts",
      noCheck: false,
    },
    {
      filePath: "./src/analyzer/index.ts",
      outFile: "./build/dist/analyzer.d.ts",
      noCheck: false,
    },
  ],
};

module.exports = config;
