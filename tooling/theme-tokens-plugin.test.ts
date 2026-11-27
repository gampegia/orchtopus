import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { themeTokensPlugin, writeThemeCss } from './theme-tokens-plugin';

const lagoonPath = join(import.meta.dirname, '..', 'themes', 'lagoon', 'tokens.json');
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theme-tokens-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeThemeCss', () => {
  it('writes the Lagoon CSS custom properties', () => {
    const output = join(tempDir(), 'generated', 'lagoon.css');
    const lagoon = JSON.parse(readFileSync(lagoonPath, 'utf8')) as {
      light: object;
      dark: object;
    };
    const count = writeThemeCss({ source: lagoonPath, output });
    expect(count).toBe(Object.keys(lagoon.light).length + Object.keys(lagoon.dark).length);
    expect(readFileSync(output, 'utf8')).toContain('--surface-page: #e3e7e5;');
  });

  it('names the source file when the JSON is malformed', () => {
    const dir = tempDir();
    const source = join(dir, 'tokens.json');
    writeFileSync(source, '{ "name": ');
    expect(() => writeThemeCss({ source, output: join(dir, 'out.css') })).toThrow(source);
  });

  it('writes nothing for an incomplete theme', () => {
    const dir = tempDir();
    const source = join(dir, 'tokens.json');
    const output = join(dir, 'out.css');
    writeFileSync(
      source,
      JSON.stringify({
        name: 'acme-app',
        version: '1.0.0',
        light: { 'text.primary': '#000' },
        dark: {},
      }),
    );
    expect(() => writeThemeCss({ source, output })).toThrow('misses tokens: dark: text.primary');
    expect(existsSync(output)).toBe(false);
  });

  it('names the source file when the CSS cannot be written', () => {
    const dir = tempDir();
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a folder');
    expect(() => writeThemeCss({ source: lagoonPath, output: join(blocker, 'out.css') })).toThrow(
      lagoonPath,
    );
  });
});

describe('themeTokensPlugin', () => {
  function startDevServer(source: string, output: string) {
    const watched: string[] = [];
    const errors: string[] = [];
    let onChange: ((path: string) => void) | undefined;
    const server = {
      config: {
        logger: {
          error: (message: string) => {
            errors.push(message);
          },
        },
      },
      watcher: {
        add: (path: string) => {
          watched.push(path);
        },
        on: (event: string, listener: (path: string) => void) => {
          if (event === 'change') onChange = listener;
        },
      },
    } as unknown as ViteDevServer;
    const configureServer = themeTokensPlugin({ source, output }).configureServer;
    expect(typeof configureServer).toBe('function');
    if (typeof configureServer === 'function') {
      void configureServer.call({} as never, server);
    }
    return { watched, errors, change: (path: string) => onChange?.(path) };
  }

  it('regenerates the CSS when tokens.json changes during dev', () => {
    const dir = tempDir();
    const source = join(dir, 'tokens.json');
    const output = join(dir, 'out.css');
    copyFileSync(lagoonPath, source);
    const { watched, change } = startDevServer(source, output);
    expect(watched).toEqual([source]);
    change(join(dir, 'other.json'));
    expect(existsSync(output)).toBe(false);
    change(source);
    expect(readFileSync(output, 'utf8')).toContain('--surface-page: #e3e7e5;');
  });

  it('logs a broken tokens.json during dev instead of stopping the server', () => {
    const dir = tempDir();
    const source = join(dir, 'tokens.json');
    writeFileSync(source, '{ "name": ');
    const { errors, change } = startDevServer(source, join(dir, 'out.css'));
    expect(() => {
      change(source);
    }).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(source);
  });
});
