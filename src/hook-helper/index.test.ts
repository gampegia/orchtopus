import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDataPaths } from '../main/data-folder';
import { makeTempDir, type TempDir } from '../main/store/testing';
import { parseEnvelope } from '../shared/hook-envelope';
import { PR_BLOCK_REASON } from '../shared/pr-block';
import { HELPER_FILES, POST_TIMEOUT_MS, runHelper, type PostFn } from './index';

const TOKEN = 'a'.repeat(64);
const NOW = new Date('2026-11-27T09:00:00.000Z');

let temp: TempDir;

beforeEach(() => {
  temp = makeTempDir();
});

afterEach(() => {
  vi.useRealTimers();
  temp.remove();
});

function writeApiFiles(port = 4321): void {
  writeFileSync(join(temp.dir, 'api.json'), JSON.stringify({ port, pid: 1, startedAt: '' }));
  writeFileSync(join(temp.dir, 'api-token'), `${TOKEN}\n`);
}

function spoolLines(): string[] {
  const file = join(temp.dir, 'spool', 'events.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

interface PostCall {
  url: string;
  token: string;
  body: string;
  timeoutMs: number;
}

function recordingPost(status: number): { calls: PostCall[]; post: typeof fakePost } {
  const calls: PostCall[] = [];
  return {
    calls,
    post: (url, token, body, timeoutMs) => {
      calls.push({ url, token, body, timeoutMs });
      return Promise.resolve(status);
    },
  };
}

const fakePost: PostFn = () => Promise.resolve(202);

const preToolUse = JSON.stringify({
  session_id: 'c0ffee00-0000-4000-8000-000000000001',
  cwd: 'C:\\repos\\acme-app\\.claude\\worktrees\\upload-fix',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  permission_mode: 'default',
  prompt: 'secret prompt text',
  tool_input: { command: 'echo secret-command' },
  transcript_path: 'C:\\transcripts\\x.jsonl',
});

function run(
  argv: string[],
  stdin: string,
  post: typeof fakePost,
): Promise<{ exitCode: number; stdout: string }> {
  return runHelper({ argv, stdin, dataDir: temp.dir, now: () => NOW, post });
}

describe('runHelper', () => {
  it('uses the data folder file names', () => {
    const paths = resolveDataPaths({ env: { ORCHTOPUS_DATA_DIR: temp.dir }, appData: temp.dir });
    expect(join(temp.dir, HELPER_FILES.apiFile)).toBe(paths.apiFile);
    expect(join(temp.dir, HELPER_FILES.tokenFile)).toBe(paths.tokenFile);
    expect(join(temp.dir, HELPER_FILES.spoolFile)).toBe(paths.spoolFile);
  });

  it('posts the envelope with the bearer token', async () => {
    writeApiFiles();
    const { calls, post } = recordingPost(202);
    const result = await run(['state'], preToolUse, post);
    expect(result).toEqual({ exitCode: 0, stdout: '' });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('http://127.0.0.1:4321/v1/hooks/events');
    expect(call?.token).toBe(TOKEN);
    expect(call?.timeoutMs).toBe(POST_TIMEOUT_MS);
    const envelope = parseEnvelope(JSON.parse(call?.body ?? 'null'));
    expect(envelope).toMatchObject({
      v: 1,
      at: NOW.toISOString(),
      mode: 'hook',
      hook: 'PreToolUse',
      sessionId: 'c0ffee00-0000-4000-8000-000000000001',
      cwd: 'C:\\repos\\acme-app\\.claude\\worktrees\\upload-fix',
      fields: { tool_name: 'Bash', permission_mode: 'default' },
    });
    expect(envelope?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(spoolLines()).toEqual([]);
  });

  it('keeps only the listed fields', async () => {
    writeApiFiles();
    const { calls, post } = recordingPost(202);
    await run(['state'], preToolUse, post);
    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('secret prompt text');
    expect(body).not.toContain('secret-command');
    expect(body).not.toContain('transcripts');
    const parsed = JSON.parse(body) as { fields: Record<string, unknown> };
    expect(Object.keys(parsed.fields).sort()).toEqual(['permission_mode', 'tool_name']);
  });

  it('spools when the port file is missing', async () => {
    writeFileSync(join(temp.dir, 'api-token'), TOKEN);
    const { calls, post } = recordingPost(202);
    const result = await run(['state'], preToolUse, post);
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    const lines = spoolLines();
    expect(lines).toHaveLength(1);
    expect(parseEnvelope(JSON.parse(lines[0] ?? 'null'))?.hook).toBe('PreToolUse');
  });

  it('spools when the token file is missing', async () => {
    mkdirSync(temp.dir, { recursive: true });
    writeFileSync(join(temp.dir, 'api.json'), JSON.stringify({ port: 4321 }));
    const { calls, post } = recordingPost(202);
    await run(['state'], preToolUse, post);
    expect(calls).toHaveLength(0);
    expect(spoolLines()).toHaveLength(1);
  });

  it('spools when the API answers 500', async () => {
    writeApiFiles();
    const { calls, post } = recordingPost(500);
    await run(['state'], preToolUse, post);
    expect(calls).toHaveLength(1);
    const lines = spoolLines();
    expect(lines).toHaveLength(1);
    // The spooled line is the body that was posted, so the id stays the same.
    expect(lines[0]).toBe(calls[0]?.body);
  });

  it('spools when post rejects', async () => {
    writeApiFiles();
    await run(['state'], preToolUse, () => Promise.reject(new Error('ECONNREFUSED')));
    expect(spoolLines()).toHaveLength(1);
  });

  it('spools after the 500 ms timeout', async () => {
    vi.useFakeTimers();
    writeApiFiles();
    const pending = run(['state'], preToolUse, () => new Promise<number>(() => undefined));
    await vi.advanceTimersByTimeAsync(POST_TIMEOUT_MS - 1);
    expect(spoolLines()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.exitCode).toBe(0);
    expect(spoolLines()).toHaveLength(1);
  });

  it('state mode exits 0 on malformed stdin', async () => {
    writeApiFiles();
    const { calls, post } = recordingPost(202);
    for (const stdin of ['', '{not json', '[]', 'null', '"text"']) {
      await expect(run(['state'], stdin, post)).resolves.toEqual({ exitCode: 0, stdout: '' });
    }
    expect(calls).toHaveLength(0);
    expect(spoolLines()).toHaveLength(0);
  });

  it('state mode exits 0 when the spool cannot be written', async () => {
    // A file where the spool folder should be makes the append throw.
    writeFileSync(join(temp.dir, 'spool'), 'not a folder');
    await expect(run(['state'], preToolUse, fakePost)).resolves.toEqual({
      exitCode: 0,
      stdout: '',
    });
  });

  it('exits 0 for an unknown mode without sending', async () => {
    writeApiFiles();
    const { calls, post } = recordingPost(202);
    await expect(run(['other'], preToolUse, post)).resolves.toEqual({ exitCode: 0, stdout: '' });
    await expect(run([], preToolUse, post)).resolves.toEqual({ exitCode: 0, stdout: '' });
    expect(calls).toHaveLength(0);
  });

  it('statusline prints ctx 18 % and ctx unknown for null', async () => {
    writeApiFiles();
    const { calls, post } = recordingPost(202);
    const input = {
      session_id: 'c0ffee00-0000-4000-8000-000000000001',
      cwd: 'C:\\repos\\acme-app',
      model: { id: 'claude-opus-5-5', display_name: 'Opus' },
      context_window: { used_percentage: 18.4 },
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: 1764237600 },
        seven_day: { used_percentage: 7, resets_at: 1764720000 },
      },
    };
    const first = await run(['statusline'], JSON.stringify(input), post);
    expect(first).toEqual({ exitCode: 0, stdout: 'ctx 18 %' });
    const envelope = parseEnvelope(JSON.parse(calls[0]?.body ?? 'null'));
    expect(envelope).toMatchObject({
      mode: 'statusline',
      hook: 'statusline',
      fields: {
        contextPct: 18.4,
        fiveHourPct: 42,
        fiveHourResetsAt: 1764237600,
        sevenDayPct: 7,
        sevenDayResetsAt: 1764720000,
        model: 'claude-opus-5-5',
      },
    });

    const second = await run(
      ['statusline'],
      JSON.stringify({
        ...input,
        context_window: { used_percentage: null },
        rate_limits: undefined,
      }),
      post,
    );
    expect(second).toEqual({ exitCode: 0, stdout: 'ctx unknown' });
    const next = parseEnvelope(JSON.parse(calls[1]?.body ?? 'null'));
    expect(next?.fields).toEqual({ contextPct: null, model: 'claude-opus-5-5' });

    const malformed = await run(['statusline'], '{oops', post);
    expect(malformed).toEqual({ exitCode: 0, stdout: 'ctx unknown' });
    expect(calls).toHaveLength(2);
  });

  it('statusline writes the status text through io.write before sending', async () => {
    writeApiFiles();
    const order: string[] = [];
    // The API hangs: the status line must not wait for it.
    const hangingPost: PostFn = () => {
      order.push('post');
      return new Promise<number>(() => undefined);
    };
    vi.useFakeTimers();
    const result = runHelper({
      argv: ['statusline'],
      stdin: JSON.stringify({
        session_id: 'c0ffee00-0000-4000-8000-000000000001',
        context_window: { used_percentage: 18 },
      }),
      dataDir: temp.dir,
      now: () => NOW,
      post: hangingPost,
      write: (text) => {
        order.push(`write ${text}`);
      },
    });
    await vi.advanceTimersByTimeAsync(POST_TIMEOUT_MS);
    await expect(result).resolves.toEqual({ exitCode: 0, stdout: '' });
    expect(order).toEqual(['write ctx 18 %', 'post']);
  });

  it('state mode never calls io.write', async () => {
    writeApiFiles();
    const write = vi.fn();
    const result = await runHelper({
      argv: ['state'],
      stdin: preToolUse,
      dataDir: temp.dir,
      now: () => NOW,
      post: fakePost,
      write,
    });
    expect(result).toEqual({ exitCode: 0, stdout: '' });
    expect(write).not.toHaveBeenCalled();
  });
});

describe('runHelper pr-block', () => {
  function shellCall(command: unknown): string {
    return JSON.stringify({
      session_id: 'c0ffee00-0000-4000-8000-000000000001',
      cwd: 'C:\\repos\\acme-app\\.claude\\worktrees\\upload-fix',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      permission_mode: 'auto',
      tool_input: { command, description: 'secret description' },
    });
  }

  it('pr-block denies gh pr create with PR_BLOCK_REASON', async () => {
    writeApiFiles();
    const result = await run(['pr-block'], shellCall('gh pr create --draft'), fakePost);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: PR_BLOCK_REASON,
      },
    });
  });

  it('pr-block spools a hook.received envelope with the blocked kind', async () => {
    writeApiFiles();
    await run(['pr-block'], shellCall('glab mr merge 3'), fakePost);
    const lines = spoolLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('glab mr merge');
    expect(lines[0]).not.toContain('secret description');
    expect(parseEnvelope(JSON.parse(lines[0] ?? 'null'))).toMatchObject({
      mode: 'hook',
      hook: 'PreToolUse',
      sessionId: 'c0ffee00-0000-4000-8000-000000000001',
      fields: { tool_name: 'Bash', blocked: 'glab-mr-merge' },
    });
  });

  it('pr-block allows git push with empty stdout', async () => {
    writeApiFiles();
    const result = await run(['pr-block'], shellCall('git push -u origin upload-fix'), fakePost);
    expect(result).toEqual({ exitCode: 0, stdout: '' });
    expect(spoolLines()).toHaveLength(0);
  });

  it('pr-block exits non-zero on unreadable stdin', async () => {
    for (const stdin of ['', '{not json', '[]', 'null', shellCall(42), shellCall(undefined)]) {
      const result = await run(['pr-block'], stdin, fakePost);
      expect(result.exitCode, stdin).not.toBe(0);
      expect(result.stdout).toBe('');
    }
  });

  it('pr-block still denies when the spool cannot be written', async () => {
    writeFileSync(join(temp.dir, 'spool'), 'not a folder');
    const result = await run(['pr-block'], shellCall('gh pr merge 12'), fakePost);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"permissionDecision":"deny"');
  });

  it('pr-block never calls post', async () => {
    writeApiFiles();
    const { calls, post } = recordingPost(202);
    await run(['pr-block'], shellCall('gh pr create'), post);
    await run(['pr-block'], shellCall('git status'), post);
    await run(['pr-block'], '{oops', post);
    expect(calls).toHaveLength(0);
  });
});
