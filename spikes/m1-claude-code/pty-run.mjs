// Drives `claude` (or `claude attach <id>`) in a real ConPTY through node-pty
// and records what the user would see.
//
// Usage: node pty-run.mjs --name <run> [--cwd <dir>] [--cols 120] [--rows 40]
//          [--steps '<json array>' | --steps-file <file>] [--every 1000]
//          -- <claude args...>
//
// Steps: {"wait": "<regex>", "timeout": 30}  wait until the screen matches
//        {"sleep": <ms>}                      wait
//        {"send": "<text>"}                   type text ("\r" is Enter)
//        {"key": "enter|esc|left|up|down|tab|ctrl-c|ctrl-z|ctrl-d"}
//        {"snap": "<label>"}                  save the screen as text
//        {"kill": true}                       kill the PTY process
//
// Output in <scratch>/logs/pty/: <run>.raw (raw stream), <run>-<label>.txt
// (snapshots), <run>.screens.jsonl (screen whenever it changed, with --every)
// and <run>.json (summary).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { appendJsonl, claudeExe, cleanEnv, ensureDir, parseArgs, paths } from './lib/common.mjs';
import { Screen } from './lib/screen.mjs';

const require = createRequire(import.meta.url);

const KEYS = {
  enter: '\r',
  esc: '\x1b',
  left: '\x1b[D',
  right: '\x1b[C',
  up: '\x1b[A',
  down: '\x1b[B',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  'ctrl-c': '\x03',
  'ctrl-d': '\x04',
  'ctrl-z': '\x1a',
};

export async function runPty({
  name,
  args,
  cwd = paths.repo,
  cols = 120,
  rows = 40,
  steps = [],
  every = 0,
  env = {},
}) {
  const pty = require('node-pty');
  ensureDir(paths.screens);
  const base = join(paths.screens, name);
  writeFileSync(`${base}.raw`, '');
  const screen = new Screen(cols, rows);
  const t0 = Date.now();
  const proc = pty.spawn(claudeExe(), args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: cleanEnv(env),
    useConpty: true,
  });
  let exit;
  proc.onData((d) => {
    appendFileSync(`${base}.raw`, d);
    screen.write(d);
  });
  const exited = new Promise((resolve) => {
    proc.onExit((e) => {
      exit = { ...e, atMs: Date.now() - t0 };
      resolve(exit);
    });
  });

  let last = '';
  const ticker =
    every > 0
      ? setInterval(() => {
          const text = screen.text();
          if (text !== last) {
            last = text;
            appendJsonl(`${base}.screens.jsonl`, { atMs: Date.now() - t0, text });
          }
        }, every)
      : undefined;

  const snaps = [];
  const snap = (label) => {
    const file = `${base}-${label}.txt`;
    writeFileSync(file, screen.text() + '\n');
    snaps.push({ label, atMs: Date.now() - t0, file });
  };
  const log = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const step of steps) {
    if (exit) break;
    if (step.wait) {
      const re = new RegExp(step.wait, 'm');
      const deadline = Date.now() + (step.timeout ?? 30) * 1000;
      let ok = false;
      while (Date.now() < deadline && !exit) {
        if (re.test(screen.text())) {
          ok = true;
          break;
        }
        await sleep(200);
      }
      log.push({ step, ok, atMs: Date.now() - t0 });
      if (!ok && step.required !== false) snap(`timeout-${log.length}`);
    } else if (step.sleep) {
      await sleep(step.sleep);
    } else if (step.send !== undefined) {
      proc.write(step.send);
      log.push({ step, atMs: Date.now() - t0 });
    } else if (step.key) {
      proc.write(KEYS[step.key] ?? step.key);
      log.push({ step, atMs: Date.now() - t0 });
    } else if (step.snap) {
      snap(step.snap);
    } else if (step.kill) {
      proc.kill();
      log.push({ step, atMs: Date.now() - t0 });
    }
  }
  snap('final');
  if (!exit) {
    proc.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (ticker) clearInterval(ticker);
  const summary = { name, args, cwd, cols, rows, exit, steps: log, snaps };
  writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2) + '\n');
  return { ...summary, text: screen.text() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const steps = a['steps-file']
    ? JSON.parse(readFileSync(a['steps-file'], 'utf8'))
    : JSON.parse(a.steps ?? '[]');
  const res = await runPty({
    name: String(a.name ?? 'run'),
    args: a['--'] ?? [],
    cwd: a.cwd ?? paths.repo,
    cols: Number(a.cols ?? 120),
    rows: Number(a.rows ?? 40),
    every: Number(a.every ?? 0),
    steps,
  });
  console.log(res.text);
  console.log(
    '\n--- exit:',
    JSON.stringify(res.exit),
    'snaps:',
    res.snaps.map((s) => s.file).join(', '),
  );
  process.exit(0);
}
