import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, type TempDir } from '../store/testing';
import {
  readProjectConfig,
  validateBranchPrefix,
  writeProjectConfig,
  type ProjectConfig,
} from './project-config';

let temp: TempDir;
let file: string;

beforeEach(() => {
  temp = makeTempDir();
  file = join(temp.dir, 'projects', 'acme-app', 'project.json');
});

afterEach(() => {
  temp.remove();
});

function config(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    schemaVersion: 1,
    id: 'acme-app',
    name: 'acme-app',
    path: 'C:\\repos\\acme-app',
    defaultBranch: 'main',
    remotes: [{ name: 'origin', url: 'https://github.com/acme/acme-app.git' }],
    provider: 'github',
    checkCommands: { test: 'npm test', lint: 'npm run lint', typecheck: null },
    copyList: ['.env', '.env.local'],
    branchPrefix: 'orch/',
    lastStart: { model: null, effort: null, mode: 'auto' },
    ...overrides,
  };
}

describe('project config', () => {
  it('round trip', async () => {
    await writeProjectConfig(file, config());
    await expect(readProjectConfig(file)).resolves.toEqual(config());
    // The temp file is gone after the rename.
    expect(await readdir(dirname(file))).toEqual(['project.json']);
  });

  it('overwrites an existing config', async () => {
    await writeProjectConfig(file, config());
    await writeProjectConfig(file, config({ branchPrefix: 'feat/' }));
    await expect(readProjectConfig(file)).resolves.toMatchObject({ branchPrefix: 'feat/' });
  });

  it('rejects schemaVersion 2', async () => {
    await writeProjectConfig(file, config());
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...raw, schemaVersion: 2 }), 'utf8');
    await expect(readProjectConfig(file)).rejects.toThrow();
  });

  it('rejects a copyList entry with ..', async () => {
    await expect(
      writeProjectConfig(file, config({ copyList: ['../secrets.env'] })),
    ).rejects.toThrow();
    await expect(
      writeProjectConfig(file, config({ copyList: ['config\\..\\..\\x'] })),
    ).rejects.toThrow();
    await expect(writeProjectConfig(file, config({ copyList: ['C:\\x\\.env'] }))).rejects.toThrow();
    await expect(writeProjectConfig(file, config({ copyList: ['/etc/.env'] }))).rejects.toThrow();
  });

  it('rejects an unsafe project id', async () => {
    await expect(writeProjectConfig(file, config({ id: '..' }))).rejects.toThrow();
    await expect(writeProjectConfig(file, config({ id: 'a/b' }))).rejects.toThrow();
  });

  it('rejects a file that is not JSON', async () => {
    await writeProjectConfig(file, config());
    await writeFile(file, '{ not json', 'utf8');
    await expect(readProjectConfig(file)).rejects.toThrow();
  });
});

describe('validateBranchPrefix', () => {
  it('accepts the default, an empty prefix and nested prefixes', () => {
    for (const p of ['orch/', '', 'feat/acme-', 'user.demo/']) {
      expect(validateBranchPrefix(p), p).toBeNull();
    }
  });

  it('rejects prefixes git cannot use as a branch start', () => {
    for (const p of [
      '/orch',
      '-x',
      'a..b/',
      'a//b',
      'a b/',
      'a~/',
      '.hidden/',
      'x.lock/',
      'a\\b',
    ]) {
      expect(validateBranchPrefix(p), p).not.toBeNull();
    }
  });
});
