// Helpers shared by the M1 plan checks T1 to T6: worktrees in the scratch
// test repo, background sessions in a given folder, waiting for a turn to end,
// reading the hook log, and writing scrubbed evidence files.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendJsonl,
  claude,
  ensureDir,
  fwd,
  paths,
  readJsonl,
  scrub,
  sleep,
  writeJson,
} from '../lib/common.mjs';
import { tokenEnv } from '../lib/flags.mjs';
import { Screen } from '../lib/screen.mjs';

export const CHECK_LOGS = join(paths.logs, 'checks');
export const HOOK_LOG = join(paths.logs, 'command-hooks.jsonl');
export const HTTP_LOG = join(paths.logs, 'http-hooks.jsonl');

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

export const worktreePath = (task) => join(paths.repo, '.claude', 'worktrees', task);

/** The product's worktree step: exclude line once, then a fresh worktree without upstream. */
export function makeWorktree(task) {
  const exclude = join(paths.repo, '.git', 'info', 'exclude');
  const line = '/.claude/worktrees/';
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!current.split(/\r?\n/).includes(line)) {
    ensureDir(join(paths.repo, '.git', 'info'));
    appendFileSync(exclude, (current.endsWith('\n') || !current ? '' : '\n') + line + '\n');
  }
  const wt = worktreePath(task);
  const add = git(
    paths.repo,
    'worktree',
    'add',
    '--no-track',
    '-b',
    `orch/${task}`,
    wt,
    'origin/main',
  );
  if (add.code !== 0) throw new Error(`worktree add failed: ${add.err}`);
  return wt;
}

/** `claude --bg` with the product's flags in `cwd`; records the id for cleanup.mjs. */
export function startBg({ cwd, settings, prompt, mode = 'auto', extra = [], label }) {
  const flags = ['--bg', '--settings', settings, '--model', 'haiku', '--effort', 'low'];
  if (mode) flags.push('--permission-mode', mode);
  flags.push(...extra);
  if (prompt) flags.push(prompt);
  const res = claude(flags, { cwd, env: tokenEnv() });
  const out = res.stdout + res.stderr;
  const id = /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(out)?.[1];
  appendJsonl(paths.started, {
    id,
    check: label,
    argv: ['claude', ...flags].map(scrub),
    status: res.status,
    ms: res.ms,
    stdout: scrub(res.stdout),
    stderr: scrub(res.stderr),
  });
  return { id, status: res.status, stdout: res.stdout, stderr: res.stderr, ms: res.ms };
}

export function allAgents() {
  const r = claude(['agents', '--json', '--all'], { timeoutMs: 15_000 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return [];
  }
}

export const agentById = (id) => allAgents().find((a) => a.id === id);

/** Hook inputs (phase "in") logged for one Claude session id. */
export function hookInputs(sessionId) {
  return readJsonl(HOOK_LOG).filter((r) => r.phase === 'in' && r.input?.session_id === sessionId);
}

/**
 * Polls `claude agents --json --all` until the session's turn has ended:
 * state done/blocked/failed/stopped with a non-busy status, or a Stop hook
 * logged and no new hook input for `quietMs`. Returns every observed change.
 */
export async function waitTurnEnd(id, { timeoutMs = 240_000, quietMs = 12_000 } = {}) {
  const t0 = Date.now();
  const history = [];
  let last = '';
  let entry;
  while (Date.now() - t0 < timeoutMs) {
    entry = agentById(id);
    const key = JSON.stringify([entry?.state, entry?.status, entry?.waitingFor, entry?.cwd]);
    if (key !== last) {
      last = key;
      history.push({
        atMs: Date.now() - t0,
        state: entry?.state,
        status: entry?.status,
        waitingFor: entry?.waitingFor,
        cwd: entry?.cwd && scrub(fwd(entry.cwd)),
      });
    }
    if (
      entry &&
      ['done', 'blocked', 'failed', 'stopped'].includes(entry.state) &&
      entry.status !== 'busy'
    )
      return { ended: true, entry, history, ms: Date.now() - t0 };
    if (entry?.sessionId) {
      const hooks = hookInputs(entry.sessionId);
      const stop = hooks.findLast((h) => h.event === 'Stop');
      const lastTs = hooks.length ? Date.parse(hooks.at(-1).ts) : 0;
      if (stop && Date.now() - lastTs > quietMs && entry.status !== 'busy')
        return { ended: true, byStopHook: true, entry, history, ms: Date.now() - t0 };
    }
    await sleep(1500);
  }
  return { ended: false, entry, history, ms: Date.now() - t0 };
}

/** `claude logs <id>` as plain screen text, last `lines` non-empty lines. */
export function logsText(id, lines = 60) {
  const res = claude(['logs', id]);
  const screen = new Screen(120, 600);
  screen.write(res.stdout.replaceAll('\n', '\r\n'));
  return screen
    .text()
    .split('\n')
    .filter((l) => l.trim())
    .slice(-lines)
    .map(scrub);
}

/** Tool calls seen in PreToolUse/PostToolUse inputs, without file contents. */
export function toolCalls(sessionId) {
  return hookInputs(sessionId)
    .filter((h) => h.event === 'PreToolUse' || h.event === 'PostToolUse')
    .filter((h) => h.label === 'pre-tool' || h.label === 'post-tool')
    .map((h) => ({
      ts: h.ts,
      event: h.event,
      tool: h.input.tool_name,
      cwd: scrub(fwd(h.input.cwd ?? '')),
      command: h.input.tool_input?.command && scrub(h.input.tool_input.command),
      file: h.input.tool_input?.file_path && scrub(fwd(h.input.tool_input.file_path)),
      mode: h.input.permission_mode,
    }));
}

export function listDir(p) {
  try {
    return readdirSync(p);
  } catch {
    return null;
  }
}

export function writeEvidence(name, value) {
  const file = join(CHECK_LOGS, `${name}.json`);
  writeJson(file, JSON.parse(scrub(JSON.stringify(value))));
  return file;
}

export { paths, fwd, scrub, sleep, claude };
