// T4: does a background session survive when the Electron app that started it
// (plain spawn of `claude --bg`, one node-pty `claude attach`) quits or is
// killed while a turn runs?
//
// Cases: quit (app.quit() in the app), kill (taskkill /PID <main> /F),
// tree (taskkill /PID <main> /T /F). Before each case the harness sessions are
// stopped and the supervisor is given time to exit, so the case's `claude --bg`
// starts a fresh supervisor from inside the Electron process tree.
//
// Usage: node checks/t4-app-kill.mjs [--cases quit,kill,tree]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HARNESS_DIR, appendJsonl, claudeExe, cleanEnv, parseArgs } from '../lib/common.mjs';
import { tokenEnv } from '../lib/flags.mjs';
import { runPty } from '../pty-run.mjs';
import {
  CHECK_LOGS,
  agentById,
  claude,
  hookInputs,
  makeWorktree,
  paths,
  scrub,
  sleep,
  worktreePath,
  writeEvidence,
} from './_shared.mjs';

const a = parseArgs(process.argv.slice(2));
const cases = String(a.cases ?? 'quit,kill,tree').split(',');
const ELECTRON = resolve(
  HARNESS_DIR,
  '..',
  '..',
  'node_modules',
  'electron',
  'dist',
  'electron.exe',
);
const PROMPT = `Run node -e "setTimeout(()=>console.log('T4 done'),20000)" and report the output.`;

const daemonStatus = () => {
  const r = claude(['daemon', 'status'], { timeoutMs: 15_000 });
  const text = (r.stdout + r.stderr).trim();
  return {
    running: !/not running/i.test(text),
    pid: Number(/pid:\s*(\d+)/.exec(text)?.[1]) || null,
  };
};

const processTable = () => {
  const r = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  return new Map(JSON.parse(r.stdout).map((p) => [p.ProcessId, p]));
};
const ancestry = (table, pid) => {
  const chain = [];
  for (let p = table.get(pid); p && chain.length < 8; p = table.get(p.ParentProcessId))
    chain.push(`${p.Name}(${p.ProcessId})`);
  return chain;
};
const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stops and removes the harness's own sessions, then waits for the supervisor to exit. */
async function quiesce() {
  spawnSync(process.execPath, [join(HARNESS_DIR, 'cleanup.mjs')], {
    encoding: 'utf8',
    windowsHide: true,
  });
  for (let i = 0; i < 40; i++) {
    if (!daemonStatus().running) return { daemonStopped: true, waitedS: i * 1.5 };
    await sleep(1500);
  }
  return { daemonStopped: false, daemon: daemonStatus() };
}

const wt = existsSync(worktreePath('t4-probe'))
  ? worktreePath('t4-probe')
  : makeWorktree('t4-probe');
const settings = join(paths.settings, 'full.json');
const results = {};

for (const c of cases) {
  const r = { case: c };
  r.before = await quiesce();
  const statusFile = join(CHECK_LOGS, `t4-${c}-status.json`);
  const quitFlag = join(CHECK_LOGS, `t4-${c}.quit`);
  const rawFile = join(CHECK_LOGS, `t4-${c}-app-pty.raw`);
  for (const f of [statusFile, quitFlag, rawFile]) rmSync(f, { force: true });
  writeFileSync(rawFile, '');
  const args = [
    '--bg',
    '--settings',
    settings,
    '--model',
    'haiku',
    '--effort',
    'low',
    '--permission-mode',
    'auto',
    '--name',
    `t4-${c}`,
    PROMPT,
  ];
  const app = spawn(ELECTRON, [join(HARNESS_DIR, 'electron-parent.cjs')], {
    cwd: wt,
    env: cleanEnv({
      ...tokenEnv(),
      ORCH_T4_CONFIG: JSON.stringify({
        claude: claudeExe(),
        args,
        cwd: wt,
        statusFile,
        quitFlag,
        rawFile,
      }),
    }),
    stdio: 'ignore',
    windowsHide: true,
  });
  let appExit;
  app.on('exit', (code, signal) => (appExit = { code, signal, at: Date.now() }));
  const readStatus = () =>
    existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : {};

  // Wait for the id, the attach PTY and the running timer command.
  let st = {};
  for (let i = 0; i < 60 && !(st.id && st.ptyPid); i++) {
    await sleep(1000);
    st = readStatus();
  }
  r.app = {
    electronPid: st.electronPid,
    bgPid: st.bgPid,
    bgExit: st.bgExit,
    id: st.id,
    ptyPid: st.ptyPid,
  };
  if (!st.id) {
    r.error = 'no session id from the app';
    results[c] = r;
    app.kill();
    continue;
  }
  appendJsonl(paths.started, { id: st.id, check: `t4-${c}`, argv: ['claude', ...args].map(scrub) });
  let entry;
  let timerRunning = false;
  for (let i = 0; i < 60 && !timerRunning; i++) {
    entry = agentById(st.id);
    if (entry?.sessionId)
      timerRunning = hookInputs(entry.sessionId).some(
        (h) =>
          h.event === 'PreToolUse' &&
          h.label === 'pre-tool' &&
          /T4 done/.test(h.input.tool_input?.command ?? ''),
      );
    if (!timerRunning) await sleep(1000);
  }
  r.timerRunningAtKill = timerRunning;
  const table = processTable();
  const daemon = daemonStatus();
  r.treeBefore = {
    daemon: daemon.pid && ancestry(table, daemon.pid),
    worker: entry?.pid && ancestry(table, entry.pid),
    attach: ancestry(table, st.ptyPid),
  };
  const killAt = Date.now();
  if (c === 'quit') writeFileSync(quitFlag, '1');
  else {
    const tk = spawnSync(
      'taskkill',
      ['/PID', String(st.electronPid), ...(c === 'tree' ? ['/T'] : []), '/F'],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    r.taskkill = scrub((tk.stdout + tk.stderr).trim());
  }
  for (let i = 0; i < 30 && !appExit; i++) await sleep(500);
  await sleep(1500);
  r.appExit = appExit && {
    code: appExit.code,
    signal: appExit.signal,
    afterMs: appExit.at - killAt,
  };
  r.appEvents = readStatus().events?.map((e) => e.event);
  r.attachAliveAfterKill = alive(st.ptyPid);
  r.daemonAliveAfterKill = alive(daemon.pid);
  r.workerAliveAfterKill = alive(entry?.pid);

  // agents --json for 30 s after the kill.
  const watch = [];
  let last = '';
  for (let t = 0; t < 30; t += 2) {
    const e = agentById(st.id);
    const key = JSON.stringify([e?.state, e?.status, e?.pid]);
    if (key !== last)
      watch.push({ atS: t, state: e?.state ?? null, status: e?.status, pid: e?.pid, listed: !!e });
    last = key;
    await sleep(2000);
  }
  r.agentsAfterKill = watch;
  const sid = entry?.sessionId;
  const hooks = sid ? hookInputs(sid) : [];
  r.postToolTimer = hooks.some(
    (h) =>
      h.event === 'PostToolUse' &&
      h.label === 'post-tool' &&
      /T4 done/.test(h.input.tool_input?.command ?? ''),
  );
  r.stopMessage = hooks.findLast((h) => h.event === 'Stop')?.input.last_assistant_message;
  r.sessionEnd = hooks.filter((h) => h.event === 'SessionEnd').map((h) => h.input.reason);

  // Attach again and look for the finished turn on screen.
  const pty = await runPty({
    name: `t4-${c}-reattach`,
    args: ['attach', st.id],
    steps: [
      { wait: '❯', timeout: 30 },
      { sleep: 5000 },
      { snap: 'screen' },
      { key: 'ctrl-z' },
      { sleep: 1500 },
    ],
  });
  // The final screen is cleared by the Ctrl+Z detach; read the snapshot taken before it.
  const snapFile = pty.snaps.find((s) => s.label === 'screen')?.file;
  const screenText = snapFile ? readFileSync(snapFile, 'utf8') : '';
  r.reattachShowsT4done = /T4 done/.test(screenText.replace(/console\.log\('T4 done'\)/g, ''));
  r.reattachScreen = screenText
    .split('\n')
    .filter((l) => l.trim())
    .slice(-25)
    .map(scrub);
  r.pass = Boolean(r.postToolTimer && r.stopMessage && /T4 done/.test(r.stopMessage));
  results[c] = r;
  console.log(
    `${c}: appExit=${JSON.stringify(r.appExit)} attachAlive=${r.attachAliveAfterKill} daemonAlive=${r.daemonAliveAfterKill} workerAlive=${r.workerAliveAfterKill} postTool=${r.postToolTimer} stop=${JSON.stringify(r.stopMessage)} pass=${r.pass}`,
  );
  console.log(`  tree: ${JSON.stringify(r.treeBefore)}`);
  console.log(`  agents: ${JSON.stringify(watch)}`);
}
console.log('evidence:', writeEvidence('t4', results));
