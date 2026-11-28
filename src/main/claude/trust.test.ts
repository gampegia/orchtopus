import { promises as fsp } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTrust } from './trust';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orchtopus-trust-'));
  file = join(dir, '.claude.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(value: unknown): Promise<void> {
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

const root = 'C:\\Repos\\acme-app';

describe('readTrust', () => {
  it('trusted for C:/Repos/acme-app with backslash input', async () => {
    await writeConfig({
      projects: {
        'C:/Repos/other': { hasTrustDialogAccepted: false },
        'C:/Repos/acme-app': { hasTrustDialogAccepted: true, allowedTools: [] },
      },
    });
    await expect(readTrust(file, root)).resolves.toBe('trusted');
    await expect(readTrust(file, `${root}\\`)).resolves.toBe('trusted');
  });

  it('matches the key case-insensitively', async () => {
    await writeConfig({ projects: { 'c:/repos/ACME-APP': { hasTrustDialogAccepted: true } } });
    await expect(readTrust(file, root)).resolves.toBe('trusted');
  });

  it('prefers the exact key over a case variant', async () => {
    await writeConfig({
      projects: {
        'c:/repos/acme-app': { hasTrustDialogAccepted: true },
        'C:/Repos/acme-app': { hasTrustDialogAccepted: false },
      },
    });
    await expect(readTrust(file, root)).resolves.toBe('not-trusted');
  });

  it('not-trusted when false', async () => {
    await writeConfig({ projects: { 'C:/Repos/acme-app': { hasTrustDialogAccepted: false } } });
    await expect(readTrust(file, root)).resolves.toBe('not-trusted');
  });

  it('unknown for a missing file, bad JSON, missing projects', async () => {
    await expect(readTrust(join(dir, 'missing.json'), root)).resolves.toBe('unknown');
    const cases: unknown[] = [
      '{not json',
      'null',
      { numStartups: 3 },
      { projects: [] },
      { projects: { 'C:/Repos/other': { hasTrustDialogAccepted: true } } },
      { projects: { 'C:/Repos/acme-app': { allowedTools: [] } } },
      { projects: { 'C:/Repos/acme-app': { hasTrustDialogAccepted: 'yes' } } },
    ];
    for (const value of cases) {
      await writeConfig(value);
      await expect(readTrust(file, root)).resolves.toBe('unknown');
    }
  });

  it('never opens the file for writing', async () => {
    await writeConfig({ projects: { 'C:/Repos/acme-app': { hasTrustDialogAccepted: true } } });
    const open = vi.spyOn(fsp, 'open');
    const write = vi.spyOn(fsp, 'writeFile');
    const append = vi.spyOn(fsp, 'appendFile');
    const read = vi.spyOn(fsp, 'readFile');
    await expect(readTrust(file, root)).resolves.toBe('trusted');
    expect(write).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    for (const call of open.mock.calls) expect(call[1] ?? 'r').toBe('r');
    expect(read).toHaveBeenCalledTimes(1);
    const options = read.mock.calls[0]?.[1];
    const flag = typeof options === 'object' && options !== null ? options.flag : undefined;
    expect(flag ?? 'r').toBe('r');
  });
});
