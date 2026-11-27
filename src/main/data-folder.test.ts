import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectFile, resolveDataPaths, sessionFiles } from './data-folder';

const appData = join('C:', 'Users', 'demo', 'AppData', 'Roaming');

describe('resolveDataPaths', () => {
  it('uses <appData>\\Orchtopus by default', () => {
    const paths = resolveDataPaths({ env: {}, appData });
    expect(paths.root).toBe(join(appData, 'Orchtopus'));
    expect(paths.stateDb).toBe(join(appData, 'Orchtopus', 'state.db'));
  });

  it('uses ORCHTOPUS_DATA_DIR when set', () => {
    const custom = join('D:', 'tmp', 'data dir é');
    const paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: custom }, appData });
    expect(paths.root).toBe(custom);
    expect(paths.spoolFile).toBe(join(custom, 'spool', 'events.jsonl'));
  });

  it('ignores an empty ORCHTOPUS_DATA_DIR', () => {
    const paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: '' }, appData });
    expect(paths.root).toBe(join(appData, 'Orchtopus'));
  });

  it('places every file under root', () => {
    const paths = resolveDataPaths({ env: {}, appData });
    const { root, ...rest } = paths;
    for (const value of Object.values(rest)) {
      expect(value.startsWith(root + sep)).toBe(true);
    }
    expect(paths.launcher).toBe(join(root, 'bin', 'orchtopus-hook.cmd'));
    expect(paths.helper).toBe(join(root, 'bin', 'hook-helper.js'));
    expect(paths.damagedDir).toBe(join(root, 'spool', 'damaged'));
    expect(paths.electronUserData).toBe(join(root, 'electron'));
  });
});

describe('sessionFiles and projectFile', () => {
  const paths = resolveDataPaths({ env: {}, appData });

  it('builds the per-session file paths', () => {
    const files = sessionFiles(paths, 'ses-1');
    expect(files.dir).toBe(join(paths.sessionsDir, 'ses-1'));
    expect(files.settings).toBe(join(paths.sessionsDir, 'ses-1', 'settings.json'));
    expect(files.systemPrompt).toBe(join(paths.sessionsDir, 'ses-1', 'system-prompt.md'));
  });

  it('builds the project config path', () => {
    expect(projectFile(paths, 'acme-app')).toBe(
      join(paths.projectsDir, 'acme-app', 'project.json'),
    );
  });

  it('rejects ids that would leave the folder', () => {
    expect(() => sessionFiles(paths, '..')).toThrow();
    expect(() => sessionFiles(paths, 'a\\b')).toThrow();
    expect(() => projectFile(paths, '../x')).toThrow();
    expect(() => projectFile(paths, '')).toThrow();
  });
});
