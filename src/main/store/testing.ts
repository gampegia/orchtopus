// Test helpers for the store: a temp folder per test and a deterministic clock.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempDir {
  dir: string;
  file(name: string): string;
  remove(): void;
}

export function makeTempDir(): TempDir {
  const dir = mkdtempSync(join(tmpdir(), 'orchtopus-store-'));
  return {
    dir,
    file: (name) => join(dir, name),
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A clock that starts at a fixed instant and moves one second per call. */
export function stepClock(start = Date.UTC(2026, 10, 27, 9, 0, 0)): () => string {
  let now = start;
  return () => {
    const at = new Date(now).toISOString();
    now += 1000;
    return at;
  };
}
