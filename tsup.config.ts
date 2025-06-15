import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    clean: true,
    // Generate declaration file
    dts: true,
    // Generate sourcemap file
    sourcemap: true,
  },
  {
    entry: ['src/cli.ts'],
    format: ['cjs'],
    outDir: 'dist',
    clean: false,
    bundle: true,
    platform: 'node',
    // Important: adds shims for __dirname, __filename
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
    // external: [
    //   // Don't bundle these node modules
    //   'viem',
    //   'yargs',
    // ],
  },
]);
