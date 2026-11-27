import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { themeTokensPlugin } from './tooling/theme-tokens-plugin';

const root = import.meta.dirname;

export default defineConfig({
  main: {},
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
