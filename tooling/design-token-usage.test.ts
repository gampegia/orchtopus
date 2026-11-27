import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import lagoon from '../themes/lagoon/tokens.json';
import { cssVarName } from '../src/shared/tokens';

const rendererDir = join(import.meta.dirname, '..', 'src', 'renderer');
const DEFINED_VARS = new Set(
  [...Object.keys(lagoon.light), ...Object.keys(lagoon.dark)].map((token) => cssVarName(token)),
);
const HARD_CODED = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|\bstyle=\{|\b\d+(?:\.\d+)?px\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return /\.(css|tsx?|html)$/.test(entry.name) ? [path] : [];
  });
}

describe('renderer sources', () => {
  const files = sourceFiles(rendererDir);

  it('are found', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('use design tokens instead of hard-coded colours, sizes or inline styles', () => {
    const offenders = files.flatMap((file) => {
      const match = HARD_CODED.exec(readFileSync(file, 'utf8'));
      return match ? [`${relative(rendererDir, file)}: ${match[0]}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('reference only CSS variables that the Lagoon theme defines', () => {
    const unknown = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/var\(\s*(--[\w-]+)/g)]
        .map((match) => match[1] ?? '')
        .filter((name) => !DEFINED_VARS.has(name))
        .map((name) => `${relative(rendererDir, file)}: ${name}`),
    );
    expect(unknown).toEqual([]);
  });

  it('take every font family from a token', () => {
    const offenders = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/font-family:\s*([^;}]*)/g)]
        .map((match) => (match[1] ?? '').trim())
        .filter((value) => !/^var\(--[\w-]+\)$/.test(value))
        .map((value) => `${relative(rendererDir, file)}: ${value}`),
    );
    expect(offenders).toEqual([]);
  });
});
