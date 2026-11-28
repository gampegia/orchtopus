// D10 (best practices addendum): every prompt and skill Orchtopus ships is versioned and free of
// shouted emphasis; every SKILL.md stays under the documented 500 lines. No own word cap (EV-H8).
// Runs over every file in building-blocks/, so later files are covered.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontMatter, WORKFLOW_INSTRUCTION } from '../src/main/base-setup/building-blocks';

const ROOT = resolve(import.meta.dirname, '..', 'building-blocks');
const EMPHASIS = /\b(IMPORTANT|MUST|NEVER|ALWAYS|CRITICAL|REQUIRED)\b/;
const VERSION = /^\d+\.\d+\.\d+$/;

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

const files = filesIn(ROOT).map((path) => ({
  name: relative(ROOT, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));
const skills = files.filter((file) => basename(file.name) === 'SKILL.md');

describe('building blocks (D10)', () => {
  it('ships the workflow instruction', () => {
    expect(files.map((file) => file.name)).toContain(WORKFLOW_INSTRUCTION);
  });

  describe.each(files)('$name', (file) => {
    it('has a version', () => {
      expect(parseFrontMatter(file.text).fields['version']).toMatch(VERSION);
    });

    it('has no emphasis words in capitals', () => {
      // Front matter too: a skill description is read by the model as well.
      expect(file.text).not.toMatch(EMPHASIS);
    });
  });

  it.each(skills)('every SKILL.md has fewer than 500 lines ($name)', (file) => {
    expect(file.text.split('\n').length).toBeLessThan(500);
  });

  it.each(skills)(
    'a SKILL.md with side effects sets disable-model-invocation: true ($name)',
    (file) => {
      const { fields } = parseFrontMatter(file.text);
      if (fields['side-effects'] === 'true') {
        expect(fields['disable-model-invocation']).toBe('true');
      }
    },
  );
});
