# Spike harness: cross-session messaging on native Windows

Small Node 24 scripts that write messages into a running Claude Code background session's messaging pipe. Findings: `docs/spikes/2026-11-28-cross-session-messaging.md`. Builds on `../m1-claude-code/` (scratch paths, clean child environment, logging hook, PTY driver).

Everything runs against the scratch test project `%TEMP%\orchtopus-spike\acme-app` (create it with `node ../m1-claude-code/setup.mjs`). Files this spike writes:

| Path under `%TEMP%\orchtopus-spike\` | Contents |
|---|---|
| `config\settings\msg-<value>.json` | Settings per `crossSessionInbound` value (`unset`, `accept`, `hold`, `refuse`) |
| `config\msg-tokens\<session id>.txt` | `CLAUDE_CODE_MESSAGING_TOKEN` as the SessionStart hook saw it. Secret: delete after the run |
| `logs\msg-env.jsonl` | Pipe path and token fingerprint per SessionStart |
| `logs\msg-send.jsonl` | Every send: auth mode, token fingerprints, what the pipe did |
| `logs\msg-started.jsonl` | Sessions this spike started (only these are stopped by `stop.mjs`) |
| `logs\command-hooks.jsonl` | Hook inputs, labels `msg-*` (shared with the M1 harness) |

Tokens and `--raw` lines never go into a log, only a 12-character SHA-256 prefix.

## Tools

| Script | Purpose |
|---|---|
| `settings.mjs` | Writes the four settings files: logging hooks, `env-hook.mjs` on SessionStart, `worktree.bgIsolation: "none"` |
| `env-hook.mjs` | SessionStart hook: records `CLAUDE_CODE_MESSAGING_SOCKET` and the token |
| `start.mjs --inbound <value> [--mode manual\|auto] [--name n] -- "<prompt>"` | `claude --bg --settings msg-<value>.json --model haiku --effort low …` |
| `print-run.mjs --label l --inbound <value> [--mode m] -- "<prompt>"` | One `claude -p` session, for receivers `--bg` cannot start; output in `logs\msg-print-<label>.txt`. Not run yet: the bypass case was blocked (see the spike doc) |
| `send.mjs (--id <short id> \| --session <uuid>) [--text t] [--auth captured\|key\|wrong\|none\|late] [--raw '<line>'] [--wait-before ms] [--hold-open ms]` | Resolves the pid from `claude agents --json` (or, with `--session`, from the registry), the pipe from `~/.claude/sessions/<pid>.json`, writes the auth line and one message line |
| `stop.mjs [--dry-run]` | `claude stop` and `claude rm` for sessions in `msg-started.jsonl` only, then deletes `config\msg-tokens\` |

Read the receiving side with `node ../m1-claude-code/lib/logs-text.mjs <id> 30` and the transcript under `~/.claude/projects/<project>/<session id>.jsonl`. For the attached case: `node ../m1-claude-code/pty-run.mjs --name <run> --steps '<json>' -- attach <id>` and `send.mjs` from a second shell.

## Run order

1. `node settings.mjs`
2. `node start.mjs --inbound accept --mode manual --name acme-accept -- "Reply with the single word READY."`
3. `node send.mjs --id <id> --text "Reply with the single word PINEAPPLE."`
4. `node stop.mjs` (it also deletes `config\msg-tokens\`).

Gotcha: an idle background worker can be retired by the supervisor after 3 to 5 minutes (seen under low memory). It then has no pid and no pipe; `claude attach <id>` or `claude respawn <id>` wakes it with a new pipe and a new token.
