import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plugin } from 'vite';
import { buildThemeCss, parseTheme } from '../src/shared/tokens';

/** Where to read the theme tokens and where to write the CSS. Both paths are absolute. */
export interface ThemeTokensOptions {
  readonly source: string;
  readonly output: string;
}

/**
 * Reads a theme's tokens.json and writes its CSS custom properties.
 * Returns the number of tokens written (light plus dark).
 * Throws `Error('<source>: <reason>')` on any failure and writes nothing in that case.
 */
export function writeThemeCss(options: ThemeTokensOptions): number {
  let css: string;
  let count: number;
  try {
    const theme = parseTheme(JSON.parse(readFileSync(options.source, 'utf8')));
    css = buildThemeCss(theme);
    count = Object.keys(theme.light).length + Object.keys(theme.dark).length;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.source}: ${reason}`, { cause: error });
  }
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, css, 'utf8');
  return count;
}

/** Vite plugin that generates the theme CSS before Vite reads index.html, in dev and in build. */
export function themeTokensPlugin(options: ThemeTokensOptions): Plugin {
  return {
    name: 'orchtopus-theme-tokens',
    configResolved() {
      writeThemeCss(options);
    },
  };
}
