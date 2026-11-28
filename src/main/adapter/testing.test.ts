// The adapter test helpers: removing a temp folder that a child process still uses as its cwd.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeDir, sleep } from './testing';

describe('removeDir', () => {
  it('waits for a child that holds the folder as its cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orch-remove-'));
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 800)'], { cwd: dir });
    await new Promise<void>((resolve) =>
      child.once('spawn', () => {
        resolve();
      }),
    );
    await sleep(100);
    await removeDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it('accepts a folder that is already gone', async () => {
    await removeDir(join(tmpdir(), 'orch-remove-missing-acme-app'));
  });
});
