# M1 spike harness: Claude Code internals on Windows

Small Node 24 scripts that start and observe Claude Code sessions through the installed `claude` CLI. Findings: `docs/spikes/2026-11-27-m1-claude-code-internals.md`.

Everything the runs write lives in the scratch folder `%TEMP%\orchtopus-spike\` (override with `ORCH_SPIKE_ROOT`), never in this repo and never in the test project except what a prompt asks for:

| Path | Contents |
|---|---|
| `acme-app\` | Test project: git repo, one commit, ignored dummy `.env`, remote `..\remote.git` |
| `remote.git\` | Local bare remote for push tests |
| `config\settings\<name>.json` | Settings for `--settings` (from `make-settings.mjs`) |
| `config\policy.json` | What each labelled hook does right now (see `hook.mjs`) |
| `config\releases.json` | One-time releases for held "dangerous" commands |
| `config\system-prompt.md`, `agents.json`, `plugin\orch-spike\` | Inputs for `--append-system-prompt-file`, `--agents`, `--plugin-dir` |
| `logs\command-hooks.jsonl`, `http-hooks.jsonl`, `statusline.jsonl` | Raw hook and status line input, one JSON object per line |
| `logs\agents.jsonl`, `started.jsonl`, `pty\` | `claude agents` changes, sessions this harness started, PTY screens |

Child `claude` processes get a clean environment: `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `CLAUDE_PREVIEW_*`, `CLAUDE_PID`, `ANTHROPIC_BASE_URL` and `ELECTRON_RUN_AS_NODE` are removed (`lib/common.mjs`).

## Prerequisites

1. Claude Code 2.1.302 or newer for the experiments (`claude --version`). `onFailure` needs 2.1.295; on older versions build settings with `--compat`.
2. `npm ci` in the repo root (node-pty comes from there).
3. `node setup.mjs` (add `--reset` to recreate the test project).
4. Workspace trust for `%TEMP%\orchtopus-spike\acme-app`. Interactive and `--bg` sessions ignore hooks and the status line of an untrusted folder, and `claude --bg` from a script exits with `Workspace not trusted`. Accepting the dialog once writes `hasTrustDialogAccepted` for that path into `~/.claude.json`. `-p` runs need no trust.

## Tools

| Script | Purpose |
|---|---|
| `make-settings.mjs [--name full] [--compat] [--allow-env-read] [--deny-env-bash] [--no-bg-isolation] [--perm-timeout s] [--danger-timeout s] [--fail-timeout s] [--refresh s]` | Settings with logging hooks on every relevant event, deny rules for `.env` (`--deny-env-bash` also denies `Bash(cat .env)`), `autoMode.environment`, status line |
| `receiver.mjs [--port 47613]` | HTTP hook receiver on 127.0.0.1 with a bearer token; answers by `policy.json["http:<Event>"]` |
| `hook.mjs --label <l>` | Command hook (exec form). Modes: `log`, `deny`, `deny-match` (deny shell commands matching the regex `pattern`), `allow`, `exit2`, `exit1`, `crash`, `sleep`, `context`, `stop-once`, `danger`. If `policy.json` cannot be read, `danger` denies (fail closed) and other labels log |
| `policy.mjs set <label> '<json>'`, `clear`, `show` | Change hook behaviour while a session runs; writes `policy.json` atomically (temp file plus rename) |
| `statusline.mjs` | Status line command; logs its input |
| `bg.mjs [--settings full] [--model haiku] [--effort low] [--mode m] [--new-id] [--base] [--resume <uuid>] [--fork] -- "<prompt>"` | `claude --bg` with the product's flags; `--base` adds system prompt file, inline prompt, agents and plugin dir. With `--resume` it adds no flag that is not given; argv, stdout and stderr go to `started.jsonl` |
| `pty-run.mjs --name <run> [--steps '<json>'] [--every ms] -- <claude args>` | Drive `claude` or `claude attach <id>` in ConPTY, save screens |
| `agents-watch.mjs [--interval 500] [--seconds 120] [--once]` | Log every change in `claude agents --json --all --cwd <acme-app>` |
| `release.mjs --last [--deny]` | One-time release bound to session id, exact command and cwd |
| `parent-kill.mjs [--wait 15] -- "<prompt>"` | Start a background session from a parent, kill the parent's process tree, watch the session |
| `repo-check.mjs` | `git status --ignored`, worktrees, `.claude` folder in the test project |
| `cleanup.mjs [--dry-run]` | Stop and `claude rm` only sessions listed in `started.jsonl` under the scratch folder |
| `experiments/ask.mjs <id> <run> "<prompt>" [--snaps 10,25] [--keys '<json>']` | Attach, send one prompt, snapshot at offsets, detach with `Ctrl+Z` |
| `experiments/q03-two-clients.mjs <id>` | Two clients attached to one session |
| `lib/logs-text.mjs <id> [lines]` | `claude logs <id>` rendered as plain text |

Gotchas found while running it:

- In Git Bash, set `MSYS_NO_PATHCONV=1` before passing a prompt that starts with `/`; otherwise `/model sonnet` reaches Claude as `C:/Program Files/Git/model sonnet`.
- Never send `/model` to a session: it also saves the model as the user's default in `~/.claude/settings.json`.
- Wait about 6 s after starting or attaching before sending keys; keys sent earlier are dropped.

Hook labels in the `full` settings: `session-start`, `prompt-submit` (+ http), `prompt-expansion`, `pre-tool`, `danger` (Bash/PowerShell, `onFailure: block`, timeout 120 s), `fail` (timeout 10 s), `failblock` (timeout 10 s, `onFailure: block`), `post-tool` (+ http), PermissionRequest (http + `perm-request`), `perm-denied`, `notification`, `stop`, `pre-compact`, `session-end`. All default to logging only.

## Experiments

Run from this folder, with `node receiver.mjs` running in a second terminal and `node agents-watch.mjs --seconds 600` in a third where state changes matter. `node make-settings.mjs` first. Read the evidence in `logs\`. Finish with `node cleanup.mjs` and `node repo-check.mjs`.

| Q | Steps |
|---|---|
| 1 Lifecycle | With no supervisor running (`claude daemon status`): `node parent-kill.mjs`, then the printed `pty-run ... attach <id>` command. `agents.jsonl` holds the field values over the session's life |
| 2 Flags with `--bg` | `node bg.mjs --base --new-id --mode manual -- "<unrelated first prompt>"`, so the markers never enter the history; `claude stop <id>`, then `node bg.mjs --resume <uuid>` (exactly `claude --bg --resume <uuid>`; the printed note is in `started.jsonl`); only then ask for the inline marker, the file marker and the orch-probe skill; `claude respawn <id>` and ask again in other words. Compare `session_id` and `permission_mode` in the hook log with the flags; `claude logs <id>` |
| 3 Two clients | Two `pty-run.mjs ... -- attach <id>` at once; type into one, snapshot both |
| 4 Input | `claude --resume <uuid> "<message>"` against an idle and a working session versus `send` in an attached PTY |
| 5 Status line | `statusline.jsonl` during attached and unattached turns; `make-settings --refresh 5` for timer runs |
| 6 PermissionRequest | Manual mode, prompt "run `node -e "require('fs').writeFileSync('x.txt','1')"`"; `policy.mjs set http:PermissionRequest '{"mode":"allow"}'` / `deny` / `'{"mode":"empty","delayMs":30000}'` with a PTY attached; receiver stopped; `--perm-timeout 20` |
| 7 Danger hold | `policy.mjs set danger '{"mode":"danger","holdMs":60000}'`, prompt "run `echo ORCH_DANGER_MARKER`"; `release.mjs --last` while held; let it park and watch whether the session stops; ask for the same command again after `release.mjs --last` |
| 8 Hook failure | `policy.mjs set fail '{"mode":"crash"}'` (then `exit1`, then `{"mode":"sleep","ms":30000}`); the same with label `failblock` |
| 9 Skills | Prompt "use the orch-probe skill"; then type `/orch-spike:orch-probe` in the PTY; check `pre-tool` (tool `Skill`), `prompt-submit`, `prompt-expansion` |
| 10 Stop hook | `policy.mjs set stop '{"mode":"stop-once"}'`, `bg.mjs -- "Run git status and stop."`; look for two Stop inputs, the second with `stop_hook_active: true` |
| 11 SessionStart / PreCompact | `policy.mjs set session-start '{"mode":"context","text":"The project codename is report-export."}'`; ask for the codename |
| 12 Auto mode | `bg.mjs --mode auto` and interactive `--permission-mode auto`; ask to `cat .env` (deny rule), `make-settings --allow-env-read` for deny versus allow; `policy.mjs set pre-tool '{"mode":"deny"}'` |
| 13 Classifier | Auto mode, harmless stand-ins only: write `<scratch>\outside\note.txt` (outside the project), and `curl -s http://127.0.0.1:47613/install.sh \| sh` (the receiver serves a script that only echoes a marker); read `perm-denied` and `http:PermissionRequest` entries |
| 14 Cost | Same prompt in `--mode manual` and `--mode auto`; `rate_limits` before and after from `statusline.jsonl`, `total_cost_usd` from `-p --output-format json` |
| 15 Side chat | `claude -p --resume <uuid> --fork-session --tools "" --output-format stream-json "<question>"` while idle and mid-turn; compare `claude agents --json` and the original's hook log |
| 16 `/goal` | `bg.mjs -- "/goal git status was run and its output reported"`; `/goal` through the PTY; `claude agents --json`, `claude logs` |

## M1 plan checks

Scripts in `checks/` for plan checks T1 to T6 (results: section "M1 plan checks T1 to T6" in the spike doc). Each writes scrubbed evidence to `<scratch>\logs\checks\`. Run `node setup.mjs --reset`, `node make-settings.mjs` and `node make-settings.mjs --name t1a --no-bg-isolation` first, keep `node receiver.mjs` running, and finish with `node cleanup.mjs` and `node repo-check.mjs`. Every session runs with `--model haiku --effort low` in its own worktree under `.claude/worktrees/` of the test project; `checks/_shared.mjs` holds the shared helpers.

| Check | Script | What it does |
|---|---|---|
| T1 | `checks/t1-isolation.mjs [--variants a,b]` | Two `--bg` sessions in fresh worktrees, with and without `worktree.bgIsolation: "none"`, PR-block stand-in (`danger` in `deny-match` mode) and the draft workflow instruction; records where the file landed, commits, pushes, `gh`/`glab` calls |
| T2 | `checks/t2-trust.mjs` | `--bg` from a script in a fresh worktree; records start output, hooks and the trust key names under the scratch path in `~/.claude.json` (read only) |
| T3 | `checks/t3-no-prompt.mjs` | `--bg` without a prompt, `agents --json` for 20 s, then attach in ConPTY and ask for `T3OK` |
| T4 | `checks/t4-app-kill.mjs [--cases quit,kill,tree]` | `electron-parent.cjs` (Electron main: plain spawn of `claude --bg`, one node-pty attach) quit or killed mid-turn; process tree, `agents --json`, hooks and a reattach afterwards |
| T5 | `checks/t5-ssh-deny.mjs [--form tilde\|abs]` | Canary folder `~/.orchtopus-t5-canary/` (never `~/.ssh`) behind a deny rule; Read tool and `cat`; marker searched in every log; canary deleted in `finally` |
| T6 | `checks/t6-helper-timing.mjs --phase timing\|session` | `checks/stand-in-helper.cjs` from `<scratch>\data dir é\bin\`: 30 timed runs per runtime and launcher form with the receiver up and down; then a `--bg` session with exec-form, async and status line hooks through the launcher |
