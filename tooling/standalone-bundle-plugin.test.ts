import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, type TempDir } from '../src/main/store/testing';
import { buildStandaloneCjs } from './standalone-bundle-plugin';

const root = resolve(import.meta.dirname, '..');

let temp: TempDir;
let outFile: string;

beforeAll(async () => {
  temp = makeTempDir();
  outFile = join(temp.dir, 'bin', 'hook-helper.js');
  await buildStandaloneCjs({ entry: join(root, 'src/hook-helper/index.ts'), outFile });
}, 60_000);

afterAll(() => {
  temp.remove();
});

describe('buildStandaloneCjs', () => {
  it('writes one file that needs nothing but Node built-ins', () => {
    expect(readdirSync(join(temp.dir, 'bin'))).toEqual(['hook-helper.js']);
    const code = readFileSync(outFile, 'utf8');
    const required = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    expect(required.length).toBeGreaterThan(0);
    for (const name of required) expect(name).toMatch(/^node:/);
    expect(code).not.toContain('zod');
  });

  it('runs as the helper: state mode exits 0 and spools without an app', () => {
    const result = spawnSync(process.execPath, [outFile, 'state'], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'c0ffee00', cwd: 'C:\\x' }),
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    // The data folder is the parent of the helper's folder.
    const spool = readFileSync(join(temp.dir, 'spool', 'events.jsonl'), 'utf8');
    expect(spool).toContain('"hook":"Stop"');
  });

  it('prints the status line', () => {
    const result = spawnSync(process.execPath, [outFile, 'statusline'], {
      input: JSON.stringify({ context_window: { used_percentage: 18 } }),
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ctx 18 %');
  });
});
