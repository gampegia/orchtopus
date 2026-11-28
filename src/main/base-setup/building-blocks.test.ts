import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, type TempDir } from '../store/testing';
import {
  buildingBlocksDir,
  loadBuildingBlock,
  parseFrontMatter,
  renderTemplate,
  WORKFLOW_INSTRUCTION,
} from './building-blocks';

let temp: TempDir;

beforeEach(() => {
  temp = makeTempDir();
});

afterEach(() => {
  temp.remove();
});

describe('buildingBlocksDir', () => {
  it('uses the resources folder when packaged', () => {
    expect(buildingBlocksDir(true, 'C:\\app\\resources', 'C:\\src')).toBe(
      join('C:\\app\\resources', 'building-blocks'),
    );
  });

  it('uses the app root in development', () => {
    expect(buildingBlocksDir(false, 'C:\\app\\resources', 'C:\\src')).toBe(
      join('C:\\src', 'building-blocks'),
    );
  });
});

describe('parseFrontMatter', () => {
  it('reads the fields and strips the block', () => {
    const parsed = parseFrontMatter('---\nversion: 1.2.3\nname: demo\n---\n\nBody line.\n');
    expect(parsed.fields).toEqual({ version: '1.2.3', name: 'demo' });
    expect(parsed.body).toBe('Body line.\n');
  });

  it('accepts CRLF line ends', () => {
    const parsed = parseFrontMatter('---\r\nversion: 1.0.0\r\n---\r\nBody.\r\n');
    expect(parsed.fields).toEqual({ version: '1.0.0' });
    expect(parsed.body).toBe('Body.\r\n');
  });

  it('gives no fields when there is no front matter', () => {
    expect(parseFrontMatter('Just text.\n')).toEqual({ fields: {}, body: 'Just text.\n' });
  });
});

describe('loadBuildingBlock', () => {
  it('returns the version and the body without front matter', () => {
    writeFileSync(join(temp.dir, 'demo.md'), '---\nversion: 2.0.1\n---\nHello {{who}}.\n');
    expect(loadBuildingBlock(temp.dir, 'demo.md')).toEqual({
      version: '2.0.1',
      body: 'Hello {{who}}.\n',
    });
  });

  it('throws when the version is missing or not x.y.z', () => {
    writeFileSync(join(temp.dir, 'none.md'), 'No front matter.\n');
    writeFileSync(join(temp.dir, 'bad.md'), '---\nversion: one\n---\nText.\n');
    expect(() => loadBuildingBlock(temp.dir, 'none.md')).toThrow(/version/);
    expect(() => loadBuildingBlock(temp.dir, 'bad.md')).toThrow(/version/);
  });

  it('refuses a name that leaves the folder', () => {
    expect(() => loadBuildingBlock(temp.dir, '../outside.md')).toThrow(/name/);
    expect(() => loadBuildingBlock(temp.dir, 'C:\\outside.md')).toThrow(/name/);
  });

  it('loads the shipped workflow instruction', () => {
    const block = loadBuildingBlock(resolve('building-blocks'), WORKFLOW_INSTRUCTION);
    expect(block.version).toBe('1.0.0');
    expect(block.body).not.toMatch(/^---/);
    const text = renderTemplate(block.body, { branch: 'upload-fix', defaultBranch: 'main' });
    expect(text).toContain('on the branch upload-fix.');
    expect(text).toContain('Do not push to main');
  });
});

describe('renderTemplate', () => {
  it('fills every variable', () => {
    expect(renderTemplate('{{a}} and {{ b }} and {{a}}', { a: 'x', b: 'y' })).toBe('x and y and x');
  });

  it('throws on an unknown variable', () => {
    expect(() => renderTemplate('Hi {{name}}', { other: 'x' })).toThrow(/name/);
  });

  it('does not expand a variable inside a value', () => {
    expect(renderTemplate('{{a}}', { a: '{{b}}', b: 'no' })).toBe('{{b}}');
  });
});
