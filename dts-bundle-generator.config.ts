import type { Config } from 'dts-bundle-generator';

const config: Config = {
  compilationOptions: {
    preferredConfigPath: './tsconfig.json',
  },
  entries: [
    {
      filePath: './src/index.ts',
      outFile: './dist/types/index.d.ts',
      output: {
        noBanner: true,
        exportReferencedTypes: true,
        inlineDeclareExternals: true,
      },
    },
  ],
};

export default config;
