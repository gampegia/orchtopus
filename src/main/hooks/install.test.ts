import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPaths, type DataPaths } from '../data-folder';
import { makeTempDir, type TempDir } from '../store/testing';
import { installHookFiles } from './install';
import { renderLauncher } from './launcher';

let temp: TempDir;
let paths: DataPaths;
let bundle: string;
const exePath = 'C:\\Program Files\\Orchtopus\\Orchtopus.exe';

beforeEach(() => {
  temp = makeTempDir();
  paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.file('data') }, appData: temp.dir });
  bundle = temp.file('hook-helper.js');
  writeFileSync(bundle, "'use strict';\n// helper bundle\n");
});

afterEach(() => {
  temp.remove();
});

describe('installHookFiles', () => {
  it('writes the launcher and the helper into bin', async () => {
    await installHookFiles(paths, { exePath, helperBundle: bundle });
    expect(readFileSync(paths.launcher, 'utf8')).toBe(
      renderLauncher({ exePath, helperPath: paths.helper }),
    );
    expect(readFileSync(paths.helper, 'utf8')).toBe(readFileSync(bundle, 'utf8'));
    // No temp file is left behind.
    expect(readdirSync(paths.binDir).sort()).toEqual(['hook-helper.js', 'orchtopus-hook.cmd']);
  });

  it('rewrites launcher and helper on every call', async () => {
    await installHookFiles(paths, { exePath, helperBundle: bundle });
    writeFileSync(paths.launcher, '@echo off\r\nexit /b 1\r\n');
    writeFileSync(paths.helper, 'process.exit(1);\n');
    await installHookFiles(paths, { exePath, helperBundle: bundle });
    expect(readFileSync(paths.launcher, 'utf8')).toBe(
      renderLauncher({ exePath, helperPath: paths.helper }),
    );
    expect(readFileSync(paths.helper, 'utf8')).toBe(readFileSync(bundle, 'utf8'));
  });

  it('follows a moved executable and a new bundle', async () => {
    await installHookFiles(paths, { exePath, helperBundle: bundle });
    const moved = 'D:\\Apps\\Orchtopus\\Orchtopus.exe';
    writeFileSync(bundle, "'use strict';\n// helper bundle v2\n");
    await installHookFiles(paths, { exePath: moved, helperBundle: bundle });
    expect(readFileSync(paths.launcher, 'utf8')).toContain(moved);
    expect(readFileSync(paths.helper, 'utf8')).toContain('v2');
  });

  it('fails when the bundle is missing', async () => {
    await expect(
      installHookFiles(paths, { exePath, helperBundle: temp.file('missing.js') }),
    ).rejects.toThrow();
  });
});
