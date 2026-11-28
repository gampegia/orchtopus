import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, type TempDir } from '../store/testing';
import { renderLauncher } from './launcher';

const windows = process.platform === 'win32';

let temp: TempDir;

beforeEach(() => {
  temp = makeTempDir();
});

afterEach(() => {
  temp.remove();
});

const EXE = 'C:\\Program Files\\Orchtopus\\Orchtopus.exe';
const HELPER = 'C:\\Users\\demo\\AppData\\Roaming\\Orchtopus\\bin\\hook-helper.js';

function lines(text: string): string[] {
  expect(text.endsWith('\r\n')).toBe(true);
  return text.split('\r\n').slice(0, -1);
}

describe('renderLauncher', () => {
  it('renders exit 0 lines for a missing exe and helper', () => {
    expect(lines(renderLauncher({ exePath: EXE, helperPath: HELPER }))).toEqual([
      '@echo off',
      'setlocal DisableDelayedExpansion',
      `if not exist "${EXE}" exit /b 0`,
      'if not exist "%~dp0hook-helper.js" exit /b 0',
      'set ELECTRON_RUN_AS_NODE=1',
      `"${EXE}" "%~dp0hook-helper.js" %*`,
      'exit /b %ERRORLEVEL%',
    ]);
  });

  it('refers to the helper next to the launcher, never by absolute path', () => {
    const text = renderLauncher({ exePath: EXE, helperPath: HELPER });
    expect(text).not.toContain(HELPER);
    expect(text).not.toContain('AppData');
  });

  it('doubles % in paths', () => {
    const text = renderLauncher({
      exePath: 'C:\\apps\\100%\\%PATH%\\Orchtopus.exe',
      helperPath: 'C:\\data\\bin\\hook%1.js',
    });
    expect(text).toContain('if not exist "C:\\apps\\100%%\\%%PATH%%\\Orchtopus.exe" exit /b 0');
    expect(text).toContain('"%~dp0hook%%1.js"');
  });

  it('writes no chcp line for an ASCII exe path', () => {
    expect(renderLauncher({ exePath: EXE, helperPath: HELPER })).not.toContain('chcp');
  });

  it('switches to UTF-8 right after @echo off for a non-ASCII exe path', () => {
    const exePath = 'C:\\Users\\demo user é\\Orchtopus\\Orchtopus.exe';
    const text = lines(renderLauncher({ exePath, helperPath: HELPER }));
    expect(text.slice(0, 2)).toEqual(['@echo off', 'chcp 65001 >nul']);
    expect(text).toContain(`"${exePath}" "%~dp0hook-helper.js" %*`);
  });

  it('rejects paths with a quote or a line break', () => {
    expect(() => renderLauncher({ exePath: 'C:\\a"b\\x.exe', helperPath: HELPER })).toThrow();
    expect(() => renderLauncher({ exePath: 'C:\\a\nb\\x.exe', helperPath: HELPER })).toThrow();
  });
});

/** Writes launcher and helper into <dataDir>\bin\ and returns the launcher path. */
function install(dataDir: string, exePath: string, helperSource: string): string {
  const bin = join(dataDir, 'bin');
  mkdirSync(bin, { recursive: true });
  const helperPath = join(bin, 'hook-helper.js');
  writeFileSync(helperPath, helperSource, 'utf8');
  const launcher = join(bin, 'orchtopus-hook.cmd');
  writeFileSync(launcher, renderLauncher({ exePath, helperPath }), 'utf8');
  return launcher;
}

function runLauncher(launcher: string, input = ''): { status: number | null; stderr: string } {
  const result = spawnSync('cmd.exe', ['/d', '/c', launcher, 'state'], {
    input,
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { status: result.status, stderr: result.stderr };
}

/** Records what reached the helper into <dataDir>\delivered.json. */
const RECORDING_HELPER = `
const fs = require('node:fs');
const path = require('node:path');
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'delivered.json'), JSON.stringify({
  argv: process.argv.slice(2),
  stdin,
  runAsNode: process.env.ELECTRON_RUN_AS_NODE,
}));
`;

/** A runtime at a path with a space and a non-ASCII letter (hard link, else a copy). */
function runtimeAt(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'node.exe');
  try {
    linkSync(process.execPath, target);
  } catch {
    copyFileSync(process.execPath, target);
  }
  return target;
}

describe.runIf(windows)('launcher on Windows', () => {
  it('runs the helper and passes its exit code', () => {
    const launcher = install(temp.dir, process.execPath, 'process.exit(3);\n');
    expect(runLauncher(launcher).status).toBe(3);
  });

  it('exits 0 when the helper file is gone', () => {
    const launcher = install(temp.dir, process.execPath, 'process.exit(3);\n');
    rmSync(join(temp.dir, 'bin', 'hook-helper.js'));
    expect(runLauncher(launcher)).toEqual({ status: 0, stderr: '' });
  });

  it('exits 0 when the executable is gone', () => {
    const launcher = install(
      temp.dir,
      join(temp.dir, 'missing', 'Orchtopus.exe'),
      'process.exit(3);\n',
    );
    expect(runLauncher(launcher)).toEqual({ status: 0, stderr: '' });
  });

  it('works from a data folder named "data dir é"', () => {
    const dataDir = join(temp.dir, 'data dir é');
    const launcher = install(dataDir, process.execPath, RECORDING_HELPER);
    expect(runLauncher(launcher, '{"hook_event_name":"Stop"}').status).toBe(0);
    const delivered = JSON.parse(readFileSync(join(dataDir, 'delivered.json'), 'utf8')) as unknown;
    expect(delivered).toEqual({
      argv: ['state'],
      stdin: '{"hook_event_name":"Stop"}',
      runAsNode: '1',
    });
  });

  it('works with an executable path with a space and é', () => {
    const dataDir = join(temp.dir, 'data dir é');
    const exePath = runtimeAt(join(temp.dir, 'demo user é', 'Orchtopus'));
    const launcher = install(dataDir, exePath, RECORDING_HELPER);
    expect(runLauncher(launcher, '{"hook_event_name":"Stop"}').status).toBe(0);
    expect(existsSync(join(dataDir, 'delivered.json'))).toBe(true);
    expect(readFileSync(launcher, 'utf8')).toContain('chcp 65001 >nul');
  });
});
