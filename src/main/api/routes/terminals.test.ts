import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TerminalRegistry } from '../../adapter/terminals';
import { makeTempDir, type TempDir } from '../../store/testing';
import { HttpError } from '../router';
import { createTerminalRoutes } from './terminals';

let temp: TempDir;
let opened: string[];

const registry = {
  openTrust: (cwd: string) => {
    opened.push(cwd);
    return Promise.resolve('trust-1');
  },
  closeTrust: () => Promise.resolve(true),
} as unknown as TerminalRegistry;

function trust(path: string): Promise<unknown> {
  const handler = createTerminalRoutes({ registry })['POST /v1/terminals/trust'];
  if (handler === undefined) throw new Error('route missing');
  return handler({ params: {}, body: { path } });
}

beforeEach(() => {
  temp = makeTempDir();
  opened = [];
});

afterEach(() => {
  temp.remove();
});

describe('POST /v1/terminals/trust', () => {
  it('opens the terminal in the real path it checked, not in the junction it was given', async () => {
    const real = temp.file('acme-app');
    mkdirSync(real);
    const link = temp.file('acme-link');
    symlinkSync(real, link, 'junction');
    await expect(trust(link)).resolves.toEqual({
      status: 200,
      body: { terminalId: 'trust-1' },
    });
    expect(opened).toEqual([realpathSync.native(real)]);
  });

  it('refuses a UNC path and a missing folder with 422', async () => {
    for (const path of [String.raw`\\host\share\acme-app`, temp.file('missing')]) {
      await expect(trust(path)).rejects.toBeInstanceOf(HttpError);
    }
    expect(opened).toEqual([]);
  });
});
