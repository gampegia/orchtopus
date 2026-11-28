// The background adapter against the fake claude CLI (temp config dir, trusted temp folders).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAgents } from '../claude/agents';
import { AdapterError, StartError, type StartInput } from './agent-adapter';
import { buildStartArgs, createBackgroundAdapter } from './background-adapter';
import { setupFakeClaude, sleep, waitFor, type FakeClaude } from './testing';

let fake: FakeClaude;

beforeEach(() => {
  fake = setupFakeClaude();
});

afterEach(async () => {
  await fake.cleanup();
});

function input(cwd: string, change: Partial<StartInput> = {}): StartInput {
  return {
    cwd,
    settingsFile: `${fake.root}\\settings.json`,
    systemPromptFile: `${fake.root}\\workflow.md`,
    name: 'upload-fix',
    mode: 'auto',
    model: null,
    effort: null,
    prompt: null,
    agentsJson: null,
    pluginDirs: [],
    ...change,
  };
}

function adapter() {
  return createBackgroundAdapter({ cmd: fake.cmd, now: Date.now, sleep });
}

/** The argv of every `--bg` call recorded so far. */
function bgCalls(): string[][] {
  return fake.argv().filter((argv) => argv.includes('--bg'));
}

describe('background adapter', { timeout: 30_000 }, () => {
  it('passes the flags in order and omits unset model, effort and prompt', async () => {
    const a = adapter();
    const dir = fake.folder('acme-app');
    await a.start(input(dir));
    expect(bgCalls()).toHaveLength(1);
    expect(bgCalls()[0]).toEqual([
      '--bg',
      '--settings',
      `${fake.root}\\settings.json`,
      '--append-system-prompt-file',
      `${fake.root}\\workflow.md`,
      '--permission-mode',
      'auto',
      '--name',
      'upload-fix',
    ]);

    await a.start(
      input(fake.folder('acme-web'), {
        mode: 'manual',
        model: 'haiku',
        effort: 'low',
        prompt: 'Fix the upload.',
        name: 'report-export',
      }),
    );
    expect(bgCalls()[1]).toEqual([
      '--bg',
      '--settings',
      join(fake.root, 'settings.json'),
      '--append-system-prompt-file',
      join(fake.root, 'workflow.md'),
      '--model',
      'haiku',
      '--effort',
      'low',
      '--permission-mode',
      'manual',
      '--name',
      'report-export',
      'Fix the upload.',
    ]);
  });

  it('puts --agents and --plugin-dir between the system prompt file and the model', () => {
    expect(
      buildStartArgs({
        cwd: 'C:\\acme-app',
        settingsFile: 's.json',
        systemPromptFile: 'p.md',
        name: 'i18n-de',
        mode: 'auto',
        model: 'opus',
        effort: 'high',
        prompt: '--not-a-flag',
        agentsJson: '{"reviewer":{}}',
        pluginDirs: ['C:\\plugins\\a', 'C:\\plugins\\b'],
      }),
    ).toEqual([
      '--bg',
      '--settings',
      's.json',
      '--append-system-prompt-file',
      'p.md',
      '--agents',
      '{"reviewer":{}}',
      '--plugin-dir',
      'C:\\plugins\\a',
      '--plugin-dir',
      'C:\\plugins\\b',
      '--model',
      'opus',
      '--effort',
      'high',
      '--permission-mode',
      'auto',
      '--name',
      'i18n-de',
      ' --not-a-flag',
    ]);
  });

  it('never passes --session-id or bypassPermissions', async () => {
    const a = adapter();
    await a.start(input(fake.folder('acme-app'), { mode: 'manual', prompt: 'hello' }));
    await a.start(input(fake.folder('acme-web'), { mode: 'auto' }));
    for (const argv of fake.argv()) {
      expect(argv).not.toContain('--session-id');
      expect(argv.join(' ')).not.toContain('bypassPermissions');
      expect(argv).not.toContain('--bare');
    }
    expect(() =>
      buildStartArgs({
        ...input('C:\\acme-app'),
        mode: 'bypassPermissions' as unknown as 'auto',
      }),
    ).toThrow(StartError);
  });

  it('reads the session id from agents --json', async () => {
    const a = adapter();
    const dir = fake.folder('acme-app');
    const started = await a.start(input(dir, { prompt: 'hello' }));
    const entries = await listAgents(fake.cmd);
    expect(entries).toHaveLength(1);
    expect(started).toEqual({ sessionId: entries[0]?.sessionId, shortId: entries[0]?.id });
    expect(started.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    // The scenario moves on between the two calls, so compare who is listed, not the state.
    expect((await a.list()).map((e) => e.sessionId)).toEqual([started.sessionId]);
  });

  it('throws StartError when the folder is not trusted', async () => {
    const a = adapter();
    const dir = fake.folder('acme-app', false);
    const error = await a.start(input(dir)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StartError);
    expect((error as Error).message).toContain('Workspace not trusted');
  });

  it('throws StartError when no session shows up in agents --json', async () => {
    let clock = 0;
    const a = createBackgroundAdapter({
      cmd: fake.cmd,
      // Every entry looks older than the start, so none matches.
      now: () => (clock += 3_600_000) + Date.now(),
      sleep: () => Promise.resolve(),
    });
    const error = await a.start(input(fake.folder('acme-app'))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StartError);
    expect((error as Error).message).toBe('session id not found');
  });

  it('never adopts another session in the folder when a different short id was printed', async () => {
    const dir = fake.folder('acme-app');
    // `--bg` really starts a session (like a user's own one), but prints another short id.
    const wrapper = join(fake.root, 'other-id.mjs');
    writeFileSync(
      wrapper,
      [
        "import { spawnSync } from 'node:child_process';",
        'const args = process.argv.slice(2);',
        "if (args.includes('--bg')) {",
        `  spawnSync(process.execPath, [${JSON.stringify(fake.cmd.prefixArgs[0])}, ...args], { stdio: 'ignore' });`,
        "  process.stdout.write('backgrounded · 0badc0de · upload-fix\\n');",
        '} else {',
        `  await import(${JSON.stringify(pathToFileURL(fake.cmd.prefixArgs[0] ?? '').href)});`,
        '}',
      ].join('\n'),
    );
    let offset = 0;
    const a = createBackgroundAdapter({
      cmd: { command: fake.cmd.command, prefixArgs: [wrapper] },
      now: () => Date.now() + offset,
      sleep: () => {
        offset += 5_000;
        return Promise.resolve();
      },
    });
    const error = await a.start(input(dir)).catch((e: unknown) => e);
    expect((await listAgents(fake.cmd)).map((e) => e.id)).not.toContain('0badc0de');
    expect(await listAgents(fake.cmd)).toHaveLength(1);
    expect(error).toBeInstanceOf(StartError);
    expect((error as Error).message).toBe('session id not found');
  });

  it('resume and attach refuse a session whose folder is unknown', async () => {
    const a = adapter();
    const ref = { sessionId: '00000000-0000-4000-8000-000000000000', shortId: '00000000' };
    await expect(a.resume(ref)).rejects.toThrow(AdapterError);
    await expect(a.resume(ref)).rejects.toThrow('Session folder unknown.');
    await expect(a.attach(ref, { cols: 80, rows: 24 })).rejects.toThrow('Session folder unknown.');
    expect(fake.argv().filter((argv) => argv.includes('--resume'))).toEqual([]);
  });

  it('resume passes no flag besides --bg --resume', async () => {
    const a = adapter();
    const dir = fake.folder('acme-app');
    const started = await a.start(input(dir, { model: 'haiku', prompt: 'hello' }));
    await a.stop(started);
    await waitFor(async () => (await a.list())[0]?.state === 'done');

    await a.resume(started);
    const resumes = fake.argv().filter((argv) => argv.includes('--resume'));
    expect(resumes).toEqual([['--bg', '--resume', started.sessionId]]);
    const [entry] = await a.list();
    expect(entry?.sessionId).toBe(started.sessionId);
    expect(entry?.status).not.toBeNull();
  });

  it('stop uses the short id', async () => {
    const a = adapter();
    const started = await a.start(input(fake.folder('acme-app'), { prompt: 'hello' }));
    await a.stop(started);
    expect(fake.argv().filter((argv) => argv[0] === 'stop')).toEqual([['stop', started.shortId]]);
    const [entry] = await a.list();
    expect(entry?.state).toBe('done');
    expect(entry?.status).toBeNull();
  });
});
