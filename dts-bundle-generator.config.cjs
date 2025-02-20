
const config = {
  compilationOptions: {
    preferredConfigPath: './tsconfig.json',
  },
  entries: [
    {
      filePath: './src/index.ts',
      outFile: './dist/types/index.d.ts',
      libraries: {
        inlinedLibraries: [],
        importedLibraries: ['lodash'],
      },
      output: {
        noBanner: true,
        exportReferencedTypes: true,
        inlineDeclareExternals: true,
      },
    },
  ],
};

module.exports = config;
