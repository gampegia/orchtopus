import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeThemeCss } from './theme-tokens-plugin';

const lagoonPath = join(import.meta.dirname, '..', 'themes', 'lagoon', 'tokens.json');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'theme-tokens-'));
}

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
});
