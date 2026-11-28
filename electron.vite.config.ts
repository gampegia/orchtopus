import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { standaloneBundlePlugin } from './tooling/standalone-bundle-plugin';
import { themeTokensPlugin } from './tooling/theme-tokens-plugin';

const root = import.meta.dirname;

export default defineConfig({
  main: {
    plugins: [
      // The hook helper is copied alone to <data>\bin\, so it is one file without shared chunks.
      standaloneBundlePlugin({
        entry: resolve(root, 'src/hook-helper/index.ts'),
        outFile: resolve(root, 'out/main/hook-helper.js'),
      }),
    ],
  },
  preload: {},
  renderer: {
    oxc: { jsx: { runtime: 'automatic' } },
    plugins: [
      themeTokensPlugin({
        source: resolve(root, 'themes/lagoon/tokens.json'),
        output: resolve(root, 'src/renderer/generated/lagoon.css'),
      }),
    ],
  },
});
