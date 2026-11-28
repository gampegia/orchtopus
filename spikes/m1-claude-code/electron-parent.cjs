// Minimal Electron main script for check T4: starts `claude --bg` with a plain
// (not detached) child_process.spawn and one node-pty `claude attach <id>`,
// the way the product will, then idles without a window.
//
// Run: <repo>/node_modules/electron/dist/electron.exe electron-parent.cjs
// (ELECTRON_RUN_AS_NODE unset). Config comes as JSON in ORCH_T4_CONFIG:
//   { claude, args, cwd, statusFile, quitFlag, rawFile }
// The script calls app.quit() as soon as `quitFlag` exists.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const pty = require('node-pty');

const cfg = JSON.parse(process.env.ORCH_T4_CONFIG);
const drop = (k) =>
  k === 'CLAUDECODE' ||
  k === 'CLAUDE_PID' ||
  k === 'ELECTRON_RUN_AS_NODE' ||
  k === 'ANTHROPIC_BASE_URL' ||
  k === 'ORCH_T4_CONFIG' ||
  k.startsWith('CLAUDE_CODE_') ||
  k.startsWith('CLAUDE_AGENT_SDK_') ||
  k.startsWith('CLAUDE_PREVIEW_');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !drop(k)));

const status = { electronPid: process.pid, events: [] };
const save = (event, extra = {}) => {
  status.events.push({ at: new Date().toISOString(), event, ...extra });
  Object.assign(status, extra);
  fs.writeFileSync(cfg.statusFile, JSON.stringify(status, null, 2));
};

app.on('will-quit', () => save('will-quit'));
app.on('quit', () => save('quit'));

app.whenReady().then(() => {
  save('ready');
  const bg = spawn(cfg.claude, cfg.args, { cwd: cfg.cwd, env, windowsHide: true });
  let out = '';
  bg.stdout.on('data', (d) => (out += d));
  bg.stderr.on('data', (d) => (out += d));
  save('bg-spawned', { bgPid: bg.pid });
  bg.on('exit', (code) => {
    const id = /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(out)?.[1];
    save('bg-exited', { bgExit: code, id, bgOut: out.trim() });
    if (!id) return;
    // Give the session a moment, as the product will before attaching.
    setTimeout(() => {
      const p = pty.spawn(cfg.claude, ['attach', id], {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: cfg.cwd,
        env,
        useConpty: true,
      });
      p.onData((d) => fs.appendFileSync(cfg.rawFile, d));
      p.onExit((e) => save('pty-exited', { ptyExit: e }));
      save('pty-attached', { ptyPid: p.pid });
    }, 1500);
  });
  setInterval(() => {
    if (fs.existsSync(cfg.quitFlag)) {
      fs.rmSync(cfg.quitFlag, { force: true });
      save('quit-requested');
      app.quit();
    }
  }, 200);
});
