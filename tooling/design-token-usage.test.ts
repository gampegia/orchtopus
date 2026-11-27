import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererDir = join(import.meta.dirname, '..', 'src', 'renderer');
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
});
