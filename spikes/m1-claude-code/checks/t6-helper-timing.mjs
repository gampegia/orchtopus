// T6: hook helper runtime, invocation form and async hooks on Windows.
//
// Phase "timing": 30 runs per form, receiver up and down, from a data folder
// whose path has a space and a non-ASCII letter (<scratch>\data dir é\):
//   a          ELECTRON_RUN_AS_NODE=1 electron.exe stand-in-helper.cjs state
//   b-plain    cmd.exe /d /c orchtopus-hook.cmd state   (launcher as in plan Task 4, UTF-8)
//   b-chcp     the same launcher with `chcp 65001 >nul` first
//   b-dp0      the same launcher with the helper path as "%~dp0stand-in-helper.cjs"
// Form c (the launcher itself as the exec-form command) cannot be spawned by
// Node without a shell, so it is only tried inside the real session.
//
// Phase "session": one `--bg` session whose PreToolUse hooks call the
// launcher in form b and form c, plus an async hook that sleeps 3 s, and whose
// statusLine.command runs the launcher in statusline mode.
//
// Usage: node checks/t6-helper-timing.mjs --phase timing [--runs 30]
//        node checks/t6-helper-timing.mjs --phase session --launcher dp0 --statusline direct|cmd
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  HARNESS_DIR,
  RECEIVER_PORT,
  cleanEnv,
  ensureDir,
  parseArgs,
  readJson,
  readJsonl,
} from '../lib/common.mjs';
import {
  HTTP_LOG,
  fwd,
  hookInputs,
  logsText,
  makeWorktree,
  paths,
  scrub,
  startBg,
  waitTurnEnd,
  worktreePath,
  writeEvidence,
} from './_shared.mjs';

const a = parseArgs(process.argv.slice(2));
const phase = String(a.phase ?? 'timing');
const ELECTRON = resolve(
  HARNESS_DIR,
  '..',
  '..',
  'node_modules',
  'electron',
  'dist',
  'electron.exe',
);
const DATA = join(paths.root, 'data dir é');
const BIN = join(DATA, 'bin');
const HELPER = join(BIN, 'stand-in-helper.cjs');
const DOWN_PORT = 47699;

function renderLauncher(variant) {
  const helper = variant === 'dp0' ? '%~dp0stand-in-helper.cjs' : HELPER.replaceAll('%', '%%');
  const exe = ELECTRON.replaceAll('%', '%%');
  return [
    '@echo off',
    ...(variant === 'chcp' ? ['chcp 65001 >nul'] : []),
    'setlocal DisableDelayedExpansion',
    `if not exist "${exe}" exit /b 0`,
    `if not exist "${helper}" exit /b 0`,
    'set ELECTRON_RUN_AS_NODE=1',
    `"${exe}" "${helper}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
}
const launcherPath = (variant) => join(BIN, `orchtopus-hook-${variant}.cmd`);

function install() {
  ensureDir(BIN);
  copyFileSync(join(HARNESS_DIR, 'checks', 'stand-in-helper.cjs'), HELPER);
  writeFileSync(join(DATA, 'api-token'), readFileSync(paths.token, 'utf8').trim());
  writeFileSync(join(DATA, 'api.json'), JSON.stringify({ port: RECEIVER_PORT }));
  for (const v of ['plain', 'chcp', 'dp0'])
    writeFileSync(launcherPath(v), renderLauncher(v), 'utf8');
}

const setPort = (port) => writeFileSync(join(DATA, 'api.json'), JSON.stringify({ port }));
const spoolLines = () => {
  const f = join(DATA, 'spool', 'events.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
};
const receivedWithLabel = (prefix) =>
  readJsonl(HTTP_LOG).filter((r) => r.phase === 'in' && r.input?.label === prefix).length;

const payload = JSON.stringify({
  session_id: '00000000-0000-0000-0000-000000000000',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  cwd: 'C:/demo/acme-app',
  tool_input: { command: 'echo hello' },
});

function runOnce(form, tag) {
  const args = ['state', '--label', tag];
  const t = process.hrtime.bigint();
  let r;
  if (form === 'a')
    r = spawnSync(ELECTRON, [HELPER, ...args], {
      input: payload,
      env: cleanEnv({ ELECTRON_RUN_AS_NODE: '1' }),
      windowsHide: true,
    });
  else
    r = spawnSync('cmd.exe', ['/d', '/c', launcherPath(form.slice(2)), ...args], {
      input: payload,
      env: cleanEnv(),
      windowsHide: true,
    });
  return {
    ms: Number(process.hrtime.bigint() - t) / 1e6,
    status: r.status,
    err: r.error?.message,
    stderr: String(r.stderr ?? '').trim(),
  };
}

const pct = (xs, p) => {
  const s = [...xs].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]);
};

if (phase === 'timing') {
  install();
  const runs = Number(a.runs ?? 30);
  const results = {};
  const stamp = Date.now().toString(36);
  for (const receiver of ['up', 'down']) {
    setPort(receiver === 'up' ? RECEIVER_PORT : DOWN_PORT);
    for (const form of ['a', 'b-plain', 'b-chcp', 'b-dp0']) {
      const tag = `t6-${stamp}-${form}-${receiver}`;
      const spoolBefore = spoolLines();
      const times = [];
      const statuses = new Set();
      let stderr = '';
      runOnce(form, `${tag}-warmup`);
      for (let i = 0; i < runs; i++) {
        const r = runOnce(form, tag);
        times.push(r.ms);
        statuses.add(r.err ?? r.status);
        if (r.stderr) stderr = r.stderr;
      }
      const key = `${form}/${receiver}`;
      results[key] = {
        p50: pct(times, 50),
        p95: pct(times, 95),
        max: Math.round(Math.max(...times)),
        exit: [...statuses],
        delivered: receiver === 'up' ? receivedWithLabel(tag) : undefined,
        spooled: spoolLines() - spoolBefore - (receiver === 'down' ? 1 : 0),
        stderr: scrub(stderr).slice(0, 300) || undefined,
      };
      console.log(key, JSON.stringify(results[key]));
    }
  }
  setPort(RECEIVER_PORT);
  results.dataDir = scrub(DATA);
  results.runsPerForm = runs;
  results.note =
    'wall time of spawnSync from Node 24, one warm-up run per form not counted; spooled excludes the warm-up';
  console.log('evidence:', writeEvidence('t6-timing', results));
} else {
  install();
  const variant = String(a.launcher ?? 'dp0');
  const sl = String(a.statusline ?? 'direct');
  const launcher = launcherPath(variant);
  const statusCommand =
    sl === 'cmd'
      ? `cmd.exe /d /c "${fwd(launcher)}" statusline --label t6-sl-cmd`
      : `"${fwd(launcher)}" statusline --label t6-sl-direct`;
  const base = readJson(join(paths.settings, 'full.json'));
  base.statusLine = { type: 'command', command: statusCommand };
  base.hooks.PreToolUse.push({
    matcher: 'Bash',
    hooks: [
      {
        type: 'command',
        command: 'cmd.exe',
        args: ['/d', '/c', launcher, 'state', '--label', 't6-form-b'],
      },
      { type: 'command', command: launcher, args: ['state', '--label', 't6-form-c'] },
      {
        type: 'command',
        command: 'cmd.exe',
        args: ['/d', '/c', launcher, 'state', '--label', 't6-async', '--sleep', '3000'],
        async: true,
        timeout: 10,
      },
    ],
  });
  const settings = join(paths.settings, `t6-session-${sl}.json`);
  writeFileSync(settings, JSON.stringify(base, null, 2));
  const wt = existsSync(worktreePath('t6-probe'))
    ? worktreePath('t6-probe')
    : makeWorktree('t6-probe');
  const start = startBg({
    cwd: wt,
    settings,
    prompt: 'Run `echo T6 probe` with the Bash tool, then reply with the single word T6OK.',
    extra: ['--name', `t6-${sl}`],
    label: `t6-${sl}`,
  });
  const wait = start.id ? await waitTurnEnd(start.id, { timeoutMs: 120_000 }) : null;
  // Let the async hook and the last status line run land.
  await new Promise((r) => setTimeout(r, 6000));
  const sid = wait?.entry?.sessionId;
  const hooks = sid ? hookInputs(sid) : [];
  const pre = hooks.find(
    (h) => h.event === 'PreToolUse' && h.label === 'pre-tool' && h.input.tool_name === 'Bash',
  );
  const post = hooks.find(
    (h) => h.event === 'PostToolUse' && h.label === 'post-tool' && h.input.tool_name === 'Bash',
  );
  const received = readJsonl(HTTP_LOG).filter(
    (r) =>
      r.phase === 'in' &&
      String(r.input?.label ?? '').startsWith('t6-') &&
      r.input?.sessionId === sid,
  );
  const byLabel = {};
  for (const r of received) (byLabel[r.input.label] ??= []).push(r.ts);
  const screen = start.id ? logsText(start.id, 12) : [];
  const ev = {
    launcherVariant: variant,
    statusLineCommand: scrub(statusCommand),
    id: start.id,
    final: wait?.entry && { state: wait.entry.state, status: wait.entry.status },
    preToolUseAt: pre?.ts,
    postToolUseAt: post?.ts,
    preToPostMs: pre && post ? Date.parse(post.ts) - Date.parse(pre.ts) : null,
    received: byLabel,
    asyncArrivalAfterPreMs:
      byLabel['t6-async'] && pre ? Date.parse(byLabel['t6-async'][0]) - Date.parse(pre.ts) : null,
    statusLineEnvelopes: (byLabel['t6-sl-direct'] ?? byLabel['t6-sl-cmd'] ?? []).length,
    ctxOnScreen: screen.filter((l) => /ctx (\d+|unknown) %?/.test(l)),
    hookErrorsOnScreen: screen.filter((l) => /hook (error|failed)/i.test(l)),
    screen,
    spooled: spoolLines(),
  };
  console.log(JSON.stringify({ ...ev, screen: undefined }, null, 2));
  console.log('evidence:', writeEvidence(`t6-session-${sl}`, ev));
}
