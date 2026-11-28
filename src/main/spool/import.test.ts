import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookEnvelope } from '../../shared/hook-envelope';
import { resolveDataPaths, type DataPaths } from '../data-folder';
import { openStore, readEvents, type Store } from '../store/event-log';
import { getSessionState } from '../store/projections';
import { makeTempDir, type TempDir } from '../store/testing';
import { importSpool } from './import';

let temp: TempDir;
let paths: DataPaths;
let store: Store;

const CLAUDE_ID = 'c0ffee00-0000-4000-8000-000000000001';
const WORKTREE = 'C:\\repos\\acme-app\\.claude\\worktrees\\upload-fix';

beforeEach(() => {
  temp = makeTempDir();
  paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir });
  store = openStore(paths.stateDb);
});

afterEach(() => {
  store.close();
  temp.remove();
});

let clock = Date.UTC(2026, 10, 27, 9, 0, 0);

function envelope(overrides: Partial<HookEnvelope> = {}): HookEnvelope {
  clock += 1000;
  return {
    v: 1,
    id: randomUUID(),
    at: new Date(clock).toISOString(),
    mode: 'hook',
    hook: 'PreToolUse',
    sessionId: CLAUDE_ID,
    cwd: WORKTREE,
    fields: { tool_name: 'Bash' },
    ...overrides,
  };
}

function writeSpool(lines: string[], file = paths.spoolFile): void {
  mkdirSync(paths.spoolDir, { recursive: true });
  writeFileSync(file, lines.map((line) => `${line}\n`).join(''));
}

function addSession(claudeSessionId: string | null = CLAUDE_ID): void {
  store.append({
    id: randomUUID(),
    type: 'session.created',
    at: '2026-11-27T08:00:00.000Z',
    projectId: 'acme-app',
    sessionId: 'upload-fix',
    payload: {
      task: 'upload-fix',
      branch: 'upload-fix',
      worktreePath: WORKTREE,
      mode: 'manual',
      model: null,
      effort: null,
    },
  });
  if (claudeSessionId !== null) {
    store.append({
      id: randomUUID(),
      type: 'session.started',
      at: '2026-11-27T08:00:01.000Z',
      projectId: 'acme-app',
      sessionId: 'upload-fix',
      payload: { claudeSessionId, shortId: 'c0ffee00' },
    });
  }
}

function spoolFiles(): string[] {
  return existsSync(paths.spoolDir)
    ? readdirSync(paths.spoolDir).filter((n) => n !== 'damaged')
    : [];
}

/** Spool files other than drained ones, which wait for the next import. */
function pendingSpoolFiles(): string[] {
  return spoolFiles().filter((n) => !n.startsWith('events.drained-'));
}

function received(): ReturnType<typeof readEvents> {
  return readEvents(store.db).filter((e) => e.type.endsWith('.received'));
}

describe('importSpool', () => {
  it('returns zeros when there is no spool', async () => {
    await expect(importSpool(store, paths)).resolves.toEqual({
      imported: 0,
      duplicates: 0,
      damaged: 0,
    });
  });

  it('imports lines in order and truncates', async () => {
    addSession();
    const items = [
      envelope({ hook: 'SessionStart', fields: { source: 'startup' } }),
      envelope({ hook: 'PreToolUse' }),
      envelope({ hook: 'Stop' }),
      envelope({
        mode: 'statusline',
        hook: 'statusline',
        fields: { contextPct: 18, fiveHourPct: 42, model: 'claude-opus-5-5' },
      }),
    ];
    writeSpool(items.map((e) => JSON.stringify(e)));
    await expect(importSpool(store, paths)).resolves.toEqual({
      imported: 4,
      duplicates: 0,
      damaged: 0,
    });
    const events = received();
    expect(events.map((e) => e.id)).toEqual(items.map((e) => e.id));
    expect(events.map((e) => e.type)).toEqual([
      'hook.received',
      'hook.received',
      'hook.received',
      'statusline.received',
    ]);
    expect(events[0]).toMatchObject({
      sessionId: 'upload-fix',
      projectId: 'acme-app',
      at: items[0]?.at,
      payload: {
        hookEventName: 'SessionStart',
        data: { claudeSessionId: CLAUDE_ID, fields: { source: 'startup' } },
      },
    });
    expect(events[3]?.payload).toEqual({
      contextPct: 18,
      rateLimits: {
        fiveHourPct: 42,
        fiveHourResetsAt: null,
        sevenDayPct: null,
        sevenDayResetsAt: null,
      },
      model: 'claude-opus-5-5',
    });
    const state = getSessionState(store.db, 'upload-fix');
    expect(state?.lastStopAt).toBe(items[2]?.at);
    expect(state?.lastActivityAt).toBe(items[3]?.at);
    expect(state?.contextPct).toBe(18);
    expect(pendingSpoolFiles()).toEqual([]);
  });

  it('skips ids already in the store', async () => {
    const items = [envelope(), envelope()];
    writeSpool(items.map((e) => JSON.stringify(e)));
    await importSpool(store, paths);
    writeSpool([...items, envelope()].map((e) => JSON.stringify(e)));
    await expect(importSpool(store, paths)).resolves.toEqual({
      imported: 1,
      duplicates: 2,
      damaged: 0,
    });
    expect(received()).toHaveLength(3);
  });

  it('matches by worktree folder when the Claude session id is not known yet', async () => {
    addSession(null);
    const inside = envelope({
      sessionId: 'unknown-id',
      cwd: `${WORKTREE.toUpperCase()}\\src`,
    });
    const outside = envelope({ sessionId: null, cwd: 'C:\\repos\\acme-app' });
    const sibling = envelope({ sessionId: null, cwd: `${WORKTREE}-2` });
    writeSpool([inside, outside, sibling].map((e) => JSON.stringify(e)));
    await importSpool(store, paths);
    const events = received();
    expect(events[0]?.sessionId).toBe('upload-fix');
    expect(events[1]?.sessionId).toBeUndefined();
    expect(events[2]?.sessionId).toBeUndefined();
  });

  it('keeps damaged lines in damaged\\ and logs spool.damaged with the count', async () => {
    const good = envelope();
    const lines = [
      '{torn',
      JSON.stringify(good),
      JSON.stringify({ v: 2, id: 'x' }),
      '',
      'plain text',
    ];
    writeSpool(lines);
    await expect(importSpool(store, paths)).resolves.toEqual({
      imported: 1,
      duplicates: 0,
      damaged: 3,
    });
    const damagedFiles = readdirSync(paths.damagedDir);
    expect(damagedFiles).toHaveLength(1);
    const kept = readFileSync(join(paths.damagedDir, damagedFiles[0] ?? ''), 'utf8');
    expect(kept).toBe('{torn\n{"v":2,"id":"x"}\nplain text\n');
    const logged = readEvents(store.db).filter((e) => e.type === 'spool.damaged');
    expect(logged).toHaveLength(1);
    expect(logged[0]?.payload).toEqual({
      file: `damaged/${damagedFiles[0] ?? ''}`,
      reason: 'not a valid envelope',
      count: 3,
    });
    expect(pendingSpoolFiles()).toEqual([]);
  });

  it('imports a leftover importing file from a crash', async () => {
    const old = [envelope(), envelope()];
    const current = [envelope()];
    writeSpool(
      old.map((e) => JSON.stringify(e)),
      join(paths.spoolDir, 'events.importing-1764230000000.jsonl'),
    );
    writeSpool(current.map((e) => JSON.stringify(e)));
    await expect(importSpool(store, paths)).resolves.toEqual({
      imported: 3,
      duplicates: 0,
      damaged: 0,
    });
    expect(received().map((e) => e.id)).toEqual([...old, ...current].map((e) => e.id));
    expect(pendingSpoolFiles()).toEqual([]);
  });

  it('keeps the drained file and imports a late append on the next import', async () => {
    const first = envelope();
    writeSpool([JSON.stringify(first)]);
    await importSpool(store, paths);
    const drained = spoolFiles().filter((n) => n.startsWith('events.drained-'));
    expect(drained).toHaveLength(1);
    // A helper that opened events.jsonl before the rename and stalled past the settle time.
    const late = envelope();
    appendFileSync(
      join(paths.spoolDir, drained[0] ?? ''),
      `${JSON.stringify(late)}
`,
    );
    await expect(importSpool(store, paths)).resolves.toEqual({
      imported: 1,
      duplicates: 0,
      damaged: 0,
    });
    expect(received().map((e) => e.id)).toEqual([first.id, late.id]);
    expect(spoolFiles()).toEqual([]);
  });

  it('does not report damaged lines of a drained file twice', async () => {
    writeSpool(['{torn', JSON.stringify(envelope())]);
    await expect(importSpool(store, paths)).resolves.toMatchObject({ damaged: 1 });
    await expect(importSpool(store, paths)).resolves.toEqual({
      imported: 0,
      duplicates: 0,
      damaged: 0,
    });
    expect(readEvents(store.db).filter((e) => e.type === 'spool.damaged')).toHaveLength(1);
    expect(spoolFiles()).toEqual([]);
  });

  it('serializes overlapping imports', async () => {
    writeSpool([envelope(), envelope()].map((e) => JSON.stringify(e)));
    const [a, b] = await Promise.all([importSpool(store, paths), importSpool(store, paths)]);
    expect(a.imported + b.imported).toBe(2);
    expect(a.duplicates + b.duplicates).toBe(0);
    expect(received()).toHaveLength(2);
  });

  it('loses nothing while helpers append during import', async () => {
    const appender = temp.file('appender.mjs');
    const module = pathToFileURL(join(import.meta.dirname, '../../hook-helper/spool-append.ts'));
    writeFileSync(
      appender,
      `import { randomUUID } from 'node:crypto';
import { appendToSpool } from ${JSON.stringify(module.href)};
const [file, prefix] = process.argv.slice(2);
for (let i = 0; i < 200; i++) {
  appendToSpool(file, JSON.stringify({
    v: 1, id: prefix + '-' + String(i).padStart(4, '0') + '-' + randomUUID().slice(0, 8),
    at: new Date(Date.UTC(2026, 10, 27, 9, 0, 0, i)).toISOString(),
    mode: 'hook', hook: 'PreToolUse', sessionId: null, cwd: null, fields: { tool_name: 'Bash' },
  }));
  // Spread the appends over a few hundred ms so imports run while children still write.
  if (i % 10 === 0) await new Promise((r) => setTimeout(r, 15));
}
`,
    );
    let running = 4;
    const children = [0, 1, 2, 3].map(
      (n) =>
        new Promise<number | null>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--no-warnings', appender, paths.spoolFile, `w${String(n)}`],
            { stdio: 'ignore' },
          );
          child.on('error', reject);
          child.on('exit', (code) => {
            running -= 1;
            resolve(code);
          });
        }),
    );
    let damaged = 0;
    // Imports that finished while every child was still running; they prove the overlap.
    let importedWhileAppending = 0;
    while (running > 0) {
      const before = running;
      const result = await importSpool(store, paths);
      damaged += result.damaged;
      if (before === 4 && running === 4) importedWhileAppending += result.imported;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await Promise.all(children)).toEqual([0, 0, 0, 0]);
    expect(importedWhileAppending).toBeGreaterThan(0);
    damaged += (await importSpool(store, paths)).damaged;
    expect(damaged).toBe(0);
    const ids = received().map((e) => e.id);
    expect(new Set(ids).size).toBe(800);
    expect(ids).toHaveLength(800);
    expect(spoolFiles().filter((n) => n.startsWith('events.importing-'))).toEqual([]);
  }, 30_000);
});
