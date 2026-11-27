# M1 Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first Orchtopus that does the real thing end to end: add a Git repository, start a real `claude --bg` session in an Orchtopus worktree with the base setup, watch it live, quit or kill the app, reopen it and find state, events and the live terminal as they were.

**Architecture:** Approach C of the spec: everything runs in the Electron main process (local API, SQLite store, attach PTYs), and a hook helper that cannot reach the app writes to a spool file that the app imports on start. The renderer is only a client of the local API (HTTP plus two WebSocket streams); the preload passes nothing but the connection details and a folder picker. The UI and the API know Claude Code only through the `AgentAdapter` interface, implemented once by the background-session adapter from the spike.

**Tech Stack:** Electron 45, electron-vite 6, React 19, TypeScript 6.0 (strict), better-sqlite3 13, node-pty 1.1, `ws` 8, zod 4, xterm.js 6 with fit, webgl and unicode11 addons, base-ui, react-resizable-panels, zustand, lucide-react, Vitest 5, Playwright 1.65 (`_electron`).

**Status:** approved by the user on 2026-11-27.

**Spec:** `docs/specs/2026-11-27-m1-walking-skeleton-design.md` (it wins for M1). Background: `docs/spikes/2026-11-27-m1-claude-code-internals.md` (observed CLI behaviour), `docs/specs/2026-11-27-claude-code-best-practices-addendum.md` (D1 to D3, D9 to D11), `docs/specs/2026-11-26-orchtopus-product-design.md`, `DESIGN.md` (Lagoon), `docs/progress.md` (gotchas).

**Prerequisite (not a task of this plan):** the M0 leftovers PR named in the spec's Constraints (dev reload check, redirect handling, CI concurrency, the `app://` protocol instead of `file://`) is merged into `main` before Task 2 starts. Task 1 may run before it. Tasks 3 and 12 consume the app origin constant that PR introduces (expected `app://orchtopus`; use the name and value it actually exports).

**Execution:** subagent-driven development, one branch `feat/m1-walking-skeleton` in a worktree, tasks strictly in order (CLAUDE.md: parallel implementation only after M1 exists). Each task loop (implementer, spec review, code quality review, fixes) and the final review fan-out run as workflows. A follow-up to an agent that just finished goes to the same agent. At most three Opus agents at once.

## Versions

Checked on 2026-11-27 with `npm view <pkg> version time peerDependencies`. Rule for new packages: the newest release that is at least seven days old (published on or before 2026-11-20), so a fresh compromised release cannot slip in. Install with `--save-exact`. Existing pins from M0 stay as they are (TypeScript stays 6.0.3, see progress gotchas).

| Package | Version | Kind | Evidence |
|---|---|---|---|
| ws | 8.23.0 | dependency | Released 2026-11-12; WebSocket server for the event and terminal streams (Node 24 has a WebSocket client, no server). Optional peers `bufferutil`, `utf-8-validate` not installed |
| @types/ws | 8.18.2 | dev | Released 2026-09-29 |
| zod | 4.6.7 | dependency | Released 2026-10-12; request, hook envelope and `project.json` validation in main |
| @xterm/xterm | 6.0.0 | dev (bundled into the renderer) | Latest stable, 2025-12-22; no dependencies. 6.1 is still beta |
| @xterm/addon-fit | 0.11.0 | dev | Released with xterm 6.0.0 |
| @xterm/addon-webgl | 0.19.0 | dev | Released with xterm 6.0.0; falls back to the DOM renderer on context loss |
| @xterm/addon-unicode11 | 0.9.0 | dev | Released with xterm 6.0.0; Claude's TUI uses wide symbols (`✽`, `⏵`) |
| @base-ui/react | 1.9.0 | dev | Released 2026-10-09; peers `react ^17 \|\| ^18 \|\| ^19`, `react-dom` same, `@types/react` optional, `date-fns` optional (not installed). The old name `@base-ui-components/react` stopped at 1.0.0-rc.0 |
| react-resizable-panels | 4.24.1 | dev | Released 2026-11-18 (4.25.1 is from today, too new); peers `react ^18 \|\| ^19`, `@types/react ^18.2.6 \|\| ^19` |
| zustand | 5.1.0 | dev | Released 2026-11-06; peer `react >=18` optional |
| lucide-react | 1.77.0 | dev | Released 2026-11-20 (the package publishes daily); peer `react ^16.5.1 … ^19` |

React-side packages are devDependencies like `react` itself, because they are bundled into the renderer. `ws` and `zod` are runtime dependencies of the main process. Not added: Sonner, cmdk, shiki (no M1 screen needs them), `@vitejs/plugin-react` (CSP, see gotchas), jsdom or Testing Library (components are covered by e2e; pure logic lives in `src/shared`).

CLI facts checked on the installed Claude Code 2.1.332 (`claude --help`, `claude agents --help`) and the docs pages `settings`, `permissions`, `hooks`, `agent-view` on 2026-11-27:

- `--permission-mode` accepts `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. The spec's "`default`" is passed as `manual` (hook payloads then report `permission_mode: "default"`, spike Q2).
- `--effort` accepts `low`, `medium`, `high`, `xhigh`, `max`.
- `worktree.bgIsolation: "none"` is the documented key ("Let background sessions edit the working copy without a worktree"). The docs also say a session started inside an existing worktree skips the move and then asks before committing; T1 checks both.
- Command hooks: exec form `command` plus `args` (no shell), `timeout` in seconds, `onFailure: "continue" | "block"` (2.1.295+), `async: true` runs a command hook in the background and can never block.
- Permission paths: `~/path` is home-relative, `//path` absolute; Windows paths are normalized to `/c/Users/...` before matching.
- Workspace trust is keyed on the repository root; in a worktree it uses the main checkout's root. It lives in `~/.claude.json` as `projects["<path>"].hasTrustDialogAccepted`, keys written with forward slashes (`C:/...`). With `CLAUDE_CONFIG_DIR` set, the file is `$CLAUDE_CONFIG_DIR/.claude.json` and user settings are `$CLAUDE_CONFIG_DIR/settings.json`.
- `claude agents --json`: `state` (`working`, `blocked`, `done`, `failed`, `stopped`), `status` while the process is alive (`busy`, `waiting`, `idle`), `waitingFor`, `sessionId`, `id`, `name`, `cwd`, `kind`, `startedAt`, `pid`. After a reboot the docs say a session shows `failed` within 48 hours and `stopped` after that.

## Global Constraints

Every task's requirements include these lines.

- Claude Code 2.1.332 is installed; minimum supported is **2.1.302** (D2). An older or missing CLI blocks session starts with a message and the update command; Orchtopus never updates Claude Code.
- Internal formats of Claude Code (transcript JSONL, `~/.claude/jobs/`) are not parsed. `~/.claude.json` is read only for the one trust value and is never written.
- Never send `/model` or any other slash command that writes user settings. The only command Orchtopus types into a session is `/exit` in the trust step.
- Never `--bare`, never `bypassPermissions`, never `--session-id` with `--bg`. Input to a running session goes only through its attached PTY.
- Outside the worktree folder Orchtopus changes nothing in a repository except one line `/.claude/worktrees/` in `.git/info/exclude` and the metadata `git worktree add` writes. Nothing is written to `~/.claude/settings.json` or `~/.claude.json`.
- All Orchtopus files live in the data folder, read from one place (`src/main/data-folder.ts`): default `%APPDATA%\Orchtopus\`; `state.db` and the spool are always local. `ORCHTOPUS_DATA_DIR` overrides the root for tests and e2e.
- A hook of Orchtopus never blocks or slows the user's work when the app is closed or broken. Only the PR block may block, and it decides locally.
- State changes show in the session list within **2 seconds** (N2). Hook helper calls stay well under **300 ms**.
- No limit on the number of sessions or projects.
- Local API: `127.0.0.1` only, token on every request and stream, `Host` check, foreign browser origins rejected.
- Renderer: tokens only (no hard-coded colours, spacing, radii or fonts), every lamp next to a word, idle is a ring lamp, signal colours keep their meaning (blue running, amber needs you, red failed, neutral idle and stopped). The unslop checklist runs on every screen.
- Electron rules from M0 stay: context isolation, sandbox, no Node in the renderer, strict CSP without inline scripts, CSS linked from `index.html` (never imported from TS), preload stays CommonJS, no `"type"` field in `package.json`, Vitest config is `vitest.config.mts`, `ELECTRON_RUN_AS_NODE` must not be set for `dev` and `smoke:native`.
- `git` and `claude` are always spawned with an argument array, never through a shell. Child processes get the clean environment (drop `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `CLAUDE_PREVIEW_*`, `ANTHROPIC_BASE_URL`, `ELECTRON_RUN_AS_NODE`), as in `spikes/m1-claude-code/lib/common.mjs`.
- Public repository: English only; demo names only (`acme-app`, `upload-fix`, `report-export`, `i18n-de`); no real names, secrets or private paths in code, tests, fixtures, logs committed or docs.
- Conventional Commits, one or more small commits per task; `npm run check` passes before every commit from Task 2 on.

## Review Focus

The five conditions the spec implies but no feature test reaches, most likely first. Each has a pinned test in its owning task.

1. **`claude agents --json` fails, times out or prints non-JSON** (CLI updating, supervisor restarting, a respawn). Expected: every session keeps its last state word, the status bar says "Claude Code not reachable", and no session flips to "stopped". Pinned in Task 11 (`keeps last state when a poll fails`).
2. **A user profile, data folder or repository path with a space or a non-ASCII letter** (`C:\Users\demo user é\…`). Expected: hooks and the status line still reach the app, the worktree and PTY open, the settings file paths are valid. Pinned in Task 4 (launcher with such a data folder) and Task 5 (repository path with a space).
3. **The user opens the same session in their own terminal (`claude attach`)**, which takes the session over (spike Q3). Expected: the app's PTY ends, the terminal shows "Opened in another window" with a Reattach button, and the app never reattaches by itself (that would steal it back in a loop). Pinned in Task 10.
4. **A remote URL that carries credentials** (`https://x-access-token:<secret>@github.com/acme/acme-app.git`). Expected: the secret never reaches `project.json`, the event log, generated settings, the UI or a log line. Pinned in Task 5 (stripped at detection) and Task 7 (settings scan).
5. **Hook helpers appending to the spool while the app imports it, or several helpers appending at once.** Expected: no event lost, none imported twice, no line torn. Pinned in Task 4 (parallel appenders during import).

---

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `spikes/m1-claude-code/checks/*.mjs`, `electron-parent.cjs` | T1 to T6 against the real CLI | 1 |
| `docs/spikes/2026-11-27-m1-claude-code-internals.md` | T1 to T6 results appended | 1 |
| `src/main/data-folder.ts` | `DataPaths` from one place | 2 |
| `src/main/store/db.ts`, `migrations.ts` | Open SQLite (WAL), migrations, append-only triggers | 2 |
| `src/main/store/event-log.ts`, `projections.ts` | Append events, apply them to projection tables, rebuild | 2 |
| `src/main/store/actions.ts` | Logged, idempotent, resumable actions | 2 |
| `src/shared/events.ts` | Event type names and payload types | 2 |
| `src/main/api/server.ts`, `auth.ts`, `router.ts`, `streams.ts` | HTTP and WebSocket server, token, Host and Origin checks, CORS | 3 |
| `src/main/api/schemas.ts` | zod request schemas (extended by Tasks 4, 8, 10, 12) | 3 |
| `src/main/api/token-file.ts`, `port-file.ts` | Per-installation token (user-only ACL), port file | 3 |
| `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/preload-api.ts` | Connection details and folder picker for the renderer | 3 |
| `src/renderer/api/client.ts` | HTTP and stream client | 3 |
| `src/shared/api-types.ts`, `src/shared/client-state.ts` | Routes, views, stream messages; apply a message to client state | 3 |
| `e2e/launch.ts` | Launch the app with a temp data folder and the fake CLI | 3 |
| `src/hook-helper/index.ts`, `spool-append.ts` | Hook helper (bundled to `out/main/hook-helper.js`) | 4 |
| `src/shared/hook-envelope.ts` | Envelope type and parser shared by helper and app | 4 |
| `src/main/hooks/install.ts`, `launcher.ts` | Write launcher and helper to `bin\` on every start | 4 |
| `src/main/spool/import.ts` | Spool import, damaged lines | 4 |
| `src/main/git/git.ts`, `repo-info.ts`, `remote-url.ts`, `worktrees.ts` | Git runner, project detection, credential stripping, worktree create and remove | 5 |
| `src/shared/task-name.ts` | Task and branch name rules | 5 |
| `src/main/claude/cli.ts`, `claude-home.ts`, `trust.ts`, `agents.ts` | Find and run `claude`, version, config paths, trust, `agents --json` | 6 |
| `building-blocks/workflow-instruction.md` | Versioned M1 workflow instruction | 7 |
| `src/main/base-setup/settings.ts`, `building-blocks.ts` | Per-session settings file and system prompt file | 7 |
| `src/shared/pr-block.ts` | PR and MR create or merge detection | 7 |
| `tooling/building-blocks.test.ts` | D10 check on every shipped prompt and skill | 7 |
| `src/main/projects/project-config.ts`, `detect.ts`, `setup-check.ts`, `project-service.ts` | `project.json`, detection, setup check, project routes | 8 |
| `tooling/fake-claude/cli.mjs`, `worker.mjs`, `scenarios/*.json` | Fake `claude` for tests and CI | 9 |
| `src/main/adapter/agent-adapter.ts`, `background-adapter.ts`, `attach-terminal.ts`, `terminals.ts` | Adapter interface and implementation, PTYs, terminal registry and stream | 10 |
| `src/main/sessions/state-rules.ts`, `state-tracker.ts`, `agents-poller.ts` | State words, combining sources, polling | 11 |
| `src/main/sessions/session-service.ts`, `src/main/startup.ts` | Start, open, stop, remove as logged actions; restart sequence | 12 |
| `src/renderer/**` (shell, list, status bar) | Title bar, layout, session list, status bar, empty states, project menu | 13 |
| `src/renderer/**` (header, terminal) | Session header, terminal view | 14 |
| `src/renderer/**` (dialogs) | Add-project dialog with setup checklist and trust step, new-session dialog | 15 |
| `e2e/walking-skeleton.spec.ts` | Full flow against the fake CLI | 16 |
| `docs/progress.md`, `README.md`, `CLAUDE.md` | Manual real-CLI check, state, gotchas | 17 |

## Which check result changes which task

| Check | If it passes | If it fails (fallback from the spec) | Tasks affected |
|---|---|---|---|
| T1 | Settings carry `worktree.bgIsolation: "none"` (or the key T1 proves); no remote check | Stays in folder but still opens a PR: keep the PR block and add a post-turn check of the remote for PRs on the branch with a visible warning in the session header. **No setting keeps the session in Orchtopus' worktree: execution stops after Task 1 and the lead brings the options to the user.** | 7, 12, 14 |
| T2 | No trust step per worktree | Trust step per new worktree in the new-session dialog, before the start | 8, 12, 15 |
| T3 | First prompt optional | First prompt required in the new-session dialog and in the API | 12, 15 |
| T4 | Plain `spawn` of `claude --bg` and node-pty `attach` | Start `claude --bg` with `detached: true` and attach through a detached launcher, outside the app's process tree | 10 |
| T5 | Deny rule `Read(~/.ssh/**)` | The form T5 proves (`Read(//c/Users/<user>/.ssh/**)` built at run time) | 7 |
| T6 | Electron in Node mode as helper runtime, the invocation form T6 picks, `async: true` on state hooks | Another runtime or form from T6's list; state hooks synchronous with `timeout: 5` if `async` is not honoured in `--bg` | 4, 7 |

---

### Task 1: Checks T1 to T6 against the real CLI

**Agent:** implementer on Opus high (investigation against internals, like the spike). Review: spec-reviewer (Sonnet medium) checks that every question has observed evidence or is marked open. No product code.

**Files:**
- Create: `spikes/m1-claude-code/checks/t1-isolation.mjs`, `t2-trust.mjs`, `t3-no-prompt.mjs`, `t4-app-kill.mjs`, `t5-ssh-deny.mjs`, `t6-helper-timing.mjs`, `spikes/m1-claude-code/electron-parent.cjs`, `spikes/m1-claude-code/checks/stand-in-helper.cjs`
- Modify: `spikes/m1-claude-code/README.md` (one table row per check), `docs/spikes/2026-11-27-m1-claude-code-internals.md` (new section "M1 plan checks T1 to T6", one subsection per check plus a summary table with verdict and consequence)

**Interfaces:**
- Consumes: the spike harness (`lib/common.mjs`: `paths`, `claude()`, `cleanEnv()`, `claudeExe()`, `appendJsonl`; `make-settings.mjs`, `bg.mjs`, `pty-run.mjs`, `agents-watch.mjs`, `cleanup.mjs`, `repo-check.mjs`). `node setup.mjs --reset` gives a fresh `acme-app` with a local bare remote.
- Produces: verdicts T1 to T6 in the spike doc. Later tasks read them through the table "Which check result changes which task".

Runs use `--model haiku --effort low`, the scratch folder only, and `node cleanup.mjs` at the end. Each check gets at most two runs; a third is only for a contradicting result. Record what was observed (hook log, `agents --json`, `git` output, screen text), never a guess.

- [ ] **Step 1: T1, worktree isolation and git behaviour.** `t1-isolation.mjs` creates `git worktree add --no-track -b orch/t1-probe <repo>/.claude/worktrees/t1-probe origin/main`, writes `/.claude/worktrees/` to `.git/info/exclude`, then runs two `--bg` sessions with `--permission-mode auto` in that folder, each with a PR-block stand-in hook (the `danger` label in `deny` mode for any command matching `gh pr|glab mr`, logging the command) and with `--append-system-prompt-file` set to the draft text of Task 7's workflow instruction:
  - variant A: settings with `worktree.bgIsolation: "none"` (`make-settings.mjs --no-bg-isolation`);
  - variant B: the same without the key.
  Prompt: `Add a file notes/t1.txt with the line T1 probe, then finish the task.` After `done`, record for each variant: where `notes/t1.txt` landed (`git -C <worktree> status`, `git worktree list`, any new folder under `.claude/worktrees/`), commits on `orch/t1-probe`, whether the branch reached `remote.git`, every `gh`/`glab` command in the hook log, whether the session asked before committing (screen via `claude logs <id>`).
  Verdict rule: **pass** if variant A (or B) edits only inside `t1-probe`; note which variant is needed. **Stop rule:** if neither variant keeps the edit in `t1-probe`, write the verdict, stop the plan here and report to the lead, who asks the user. Do not start Task 2.

- [ ] **Step 2: T2, trust inheritance.** With `acme-app` trusted, run `claude --bg` (script, no TTY) in a second fresh worktree `.claude/worktrees/t2-probe`. Pass if it starts (no `Workspace not trusted`) and hooks fire. Also record whether the worktree path gets its own key in `~/.claude.json` (read only the key names under the scratch path).

- [ ] **Step 3: T3, start without a first prompt.** `claude --bg --settings <full> --name t3-probe` with no positional prompt in a worktree. Record exit code, stdout, the `agents --json` entry over 20 s, then attach (`pty-run.mjs`), wait for the prompt box, send `Reply with the single word T3OK.` Pass if the session starts, waits and answers.

- [ ] **Step 4: T4, app kill.** `electron-parent.cjs` is a minimal Electron main script (run with `npx electron electron-parent.cjs`, `ELECTRON_RUN_AS_NODE` unset) that starts `claude --bg` with `child_process.spawn` (not detached) and one node-pty `claude attach <id>`, exactly as the product will, then idles. `t4-app-kill.mjs` runs three cases, each with a turn in progress (prompt: `Run node -e "setTimeout(()=>console.log('T4 done'),20000)" and report the output.`): (a) `app.quit()` from the script, (b) `taskkill /PID <electron main> /F`, (c) `taskkill /PID <electron main> /T /F`. After each: `agents --json` for 30 s, then attach and check the turn finished. Pass if the session survives all three. Record which case failed if any.

- [ ] **Step 5: T5, deny rule for a home folder.** Create a canary `~/.orchtopus-t5-canary/key.txt` with a random marker (never touch `~/.ssh`). Settings deny `Read(~/.orchtopus-t5-canary/**)`. Prompt in a `--bg` session: read the file with the Read tool, then with `cat` through Bash. Pass if both are refused and the marker appears in no log. If not, repeat with `Read(//c/Users/<user>/.orchtopus-t5-canary/**)` built at run time. Delete the canary folder at the end, also on failure (`finally`).

- [ ] **Step 6: T6, helper runtime, invocation form and async hooks.** `stand-in-helper.cjs` does what the real helper will do: read `api.json` and `api-token` from a data folder, POST a 1 KB JSON envelope with a bearer token to the spike receiver (`receiver.mjs`, port from `api.json`) with a 500 ms timeout, on failure append it to `spool\events.jsonl`, exit 0. Use a data folder path with a space and a non-ASCII letter under the scratch folder (`<scratch>\data dir é\`). Measure 30 runs each, p50 and p95 wall time, receiver up and receiver down:
  - (a) Electron in Node mode: `ELECTRON_RUN_AS_NODE=1 <repo>/node_modules/electron/dist/electron.exe stand-in-helper.cjs`;
  - (b) the same through a launcher `orchtopus-hook.cmd` (content as in Task 4), invoked as `cmd.exe /d /c <launcher> state`;
  - (c) the launcher invoked directly as the exec-form `command` (only if the CLI can spawn a `.cmd` without a shell).
  Then inside a real `--bg` session, with hooks in exec form: confirm that form (b) or (c) delivers `PreToolUse` envelopes from that path; that a state hook with `async: true` that sleeps 3 s does not delay the tool call (compare `PreToolUse` to `PostToolUse` times); and which `statusLine.command` string runs the launcher in statusline mode (try `"<launcher>" statusline`, then `cmd.exe /d /c "<launcher>" statusline`). Pass if one form has p95 < 300 ms with the receiver up and works with the special path. Name the chosen form.

- [ ] **Step 7: Write the results** into the spike doc (observed facts, verdict, consequence per check, one summary table), add the README rows, run `node cleanup.mjs` and `node repo-check.mjs` (worktrees and canary gone).

- [ ] **Step 8: Commit**

```bash
git add spikes/m1-claude-code docs/spikes/2026-11-27-m1-claude-code-internals.md
git commit -m "docs(spike): M1 plan checks T1 to T6 against Claude Code 2.1.332"
```

The lead reads the verdicts, applies the fallbacks from the table above to this plan (a short "Check results" note under that table), and tells the user what was found before Task 2.

---

### Task 2: Data folder, event log, projections and logged actions

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high.

**Files:**
- Create: `src/main/data-folder.ts`, `src/main/store/db.ts`, `src/main/store/migrations.ts`, `src/main/store/event-log.ts`, `src/main/store/projections.ts`, `src/main/store/actions.ts`, `src/shared/events.ts`
- Test: `src/main/data-folder.test.ts`, `src/main/store/event-log.test.ts`, `src/main/store/projections.test.ts`, `src/main/store/actions.test.ts`
- Modify: `package.json` (zod 4.6.7)

**Interfaces:**
- Produces:
  - `resolveDataPaths(input: { env: Readonly<Record<string, string | undefined>>; appData: string }): DataPaths` with `DataPaths = { root, stateDb, apiFile, tokenFile, spoolDir, spoolFile, damagedDir, binDir, launcher, helper, sessionsDir, projectsDir, electronUserData }`. Root is `ORCHTOPUS_DATA_DIR` if set, else `<appData>\Orchtopus`. Files: `state.db`, `api.json`, `api-token`, `spool\events.jsonl`, `spool\damaged\`, `bin\orchtopus-hook.cmd`, `bin\hook-helper.js`, `sessions\`, `projects\`, `electron\`. `sessionFiles(paths, sessionId) → { dir, settings, systemPrompt }` (`settings.json`, `system-prompt.md`) and `projectFile(paths, projectId)` (`projects\<id>\project.json`).
  - `openStore(file: string): Store` with `Store = { db; append(event: NewEvent): AppendResult; has(eventId: string): boolean; transaction<T>(fn: () => T): T; close() }`. `NewEvent = { id: string; type: EventType; at: string; projectId?: string; sessionId?: string; payload: unknown }`, `AppendResult = { seq: number; duplicate: boolean }`. A duplicate id returns `{ duplicate: true }` and changes nothing.
  - `StoredEvent = NewEvent & { seq: number }` (as read back from `events`, payload parsed).
  - `applyEvent(db, event: StoredEvent): void` and `rebuildProjections(db): void` in `projections.ts`; read helpers `listProjects(db)`, `listSessions(db)`, `getSession(db, id)`, `getSessionState(db, id)`.
  - `createActionRunner(store: Store, clock: () => string): ActionRunner` with `begin(kind: ActionKind, params: unknown, actionId?: string): ActionRecord`, `step<T>(actionId: string, name: string, run: () => Promise<T>): Promise<T>`, `finish(actionId, result)`, `fail(actionId, error: string)`, `pending(): ActionRecord[]`. `ActionKind = 'project.add' | 'project.remove' | 'session.start' | 'session.open' | 'session.stop' | 'session.remove'`.
  - `src/shared/events.ts`: `EventType` union `'project.added' | 'project.updated' | 'project.removed' | 'session.created' | 'session.started' | 'session.observed' | 'session.state' | 'session.removed' | 'hook.received' | 'statusline.received' | 'action.started' | 'action.step' | 'action.finished' | 'action.failed' | 'spool.damaged'` with one payload interface each.

Schema (migration 1, `PRAGMA user_version = 1`, `journal_mode = WAL`, `foreign_keys = ON`):
- `events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, at TEXT NOT NULL, project_id TEXT, session_id TEXT, payload TEXT NOT NULL)` plus triggers `BEFORE UPDATE` and `BEFORE DELETE` that `RAISE(ABORT, 'events are append-only')`.
- Projections: `projects(id PK, name, path, config TEXT, added_at)`, `sessions(id PK, project_id, task, branch, worktree_path, type DEFAULT 'feature', claude_session_id, short_id, mode, model, effort, created_at)`, `session_state(session_id PK, word, reason, observed TEXT, last_activity_at, last_stop_at, process_started_at, starting INTEGER, start_failed TEXT, context_pct, rate_limits TEXT, updated_at)`, `actions(id PK, kind, status CHECK(status IN ('pending','done','failed')), params TEXT, steps TEXT, attempts INTEGER, result TEXT, error TEXT, created_at, updated_at)`.
- `append` writes the event and applies it to the projections in one transaction.

- [ ] **Step 1: Write the failing tests.**
  - `data-folder.test.ts`: `uses <appData>\Orchtopus by default`; `uses ORCHTOPUS_DATA_DIR when set`; `places every file under root` (all `DataPaths` values start with root).
  - `event-log.test.ts` (temp file DB): `appends and reads back in order`; `returns duplicate for a known id and keeps one row`; `rejects UPDATE on events` (`db.prepare('UPDATE events SET type = ?').run('x')` throws `events are append-only`); `rejects DELETE on events`; `reopens an existing file at user_version 1`.
  - `projections.test.ts`: `project.added then project.removed leaves no project`; `session.created, session.started, session.state fill sessions and session_state`; `rebuildProjections gives the same rows as incremental apply` (append 30 mixed events, snapshot tables, rebuild, compare); `session.started with a new process resets context_pct to null`.
  - `actions.test.ts`: `logs action.started before the first step runs` (inside the step callback, the event log already holds `action.started`); `runs each step once and records action.step`; `begin with a finished actionId returns the stored result and runs nothing`; `resumes a pending action and skips completed steps` (step 2 throws a simulated crash; a new runner on the same DB continues at step 2); `counts attempts per begin of a pending action`; `fail records the error and status failed`.
- [ ] **Step 2: Run** `npx vitest run src/main/data-folder.test.ts src/main/store` → FAIL (modules missing).
- [ ] **Step 3: Implement** the signatures above. Payloads are JSON text; `at` is an ISO string from the injected clock. `step` checks the action's recorded steps first and, if the name is recorded, returns the stored step result without running.
- [ ] **Step 4: Run** the same command → PASS; then `npm run check` → exit 0.
- [ ] **Step 5: Commit** `feat(store): data folder, append-only event log, projections and logged actions`.

---

### Task 3: Local API, token, streams, preload bridge and renderer client

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high, **security-reviewer Opus high** (local API, token, IPC, preload, CSP).

**Files:**
- Create: `src/main/api/server.ts`, `auth.ts`, `router.ts`, `streams.ts`, `schemas.ts`, `token-file.ts`, `port-file.ts`, `src/main/ipc.ts`, `src/main/app-context.ts`, `src/shared/api-types.ts`, `src/shared/client-state.ts`, `src/shared/preload-api.ts`, `src/renderer/api/client.ts`, `src/renderer/global.d.ts`, `e2e/launch.ts`
- Modify: `src/main/index.ts` (open store, start API, IPC, `app.setPath('userData', paths.electronUserData)`), `src/preload/index.ts`, `src/main/security.ts` and `src/renderer/index.html` (CSP), `e2e/app.spec.ts` (use `e2e/launch.ts`; the preload test now expects exactly the `orchtopus` key), `package.json` (`ws`, `@types/ws`)
- Test: `src/main/api/server.test.ts`, `auth.test.ts`, `token-file.test.ts`, `streams.test.ts`, `src/shared/client-state.test.ts`, `src/main/csp-meta.test.ts`

**Interfaces:**
- Consumes: `DataPaths`, `Store` (Task 2); the app origin constant from the M0 leftovers PR.
- Produces:
  - `startApiServer(opts: { paths: DataPaths; preferredPort: number; allowedOrigins: readonly string[]; routes: RouteTable; onTokenRenewed?: () => void }): Promise<ApiServer>` with `ApiServer = { port: number; token(): string; publish(message: StreamMessage): void; registerTerminalStream(handler: TerminalStreamHandler): void; close(): Promise<void> }`. `TerminalStreamHandler = (terminalId: string, socket: WebSocket) => void` (called after the upgrade passed the auth checks; unknown id → the handler closes with 1008; Task 10 provides it). `DEFAULT_API_PORT = 47620`; if busy, listen on port 0. Writes `api.json` `{ "port": n, "pid": n, "startedAt": iso }` after listening and deletes it on `close()`.
  - `RouteTable = Record<string, RouteHandler>` keyed `'<METHOD> <path>'` with `:param` segments (for example `'POST /v1/sessions/:id/stop'`), `RouteHandler = (req: { params: Record<string,string>; body: unknown }) => Promise<{ status: number; body?: unknown }>`. Bodies are validated with zod schemas exported from `src/main/api/schemas.ts` (each later task adds its own).
  - `ensureToken(file: string): Promise<string>` (32 random bytes, hex; created once per installation), `renewToken(file): Promise<string>`, `restrictToCurrentUser(file): Promise<void>` (`icacls <file> /inheritance:r /grant:r *<SID>:F`, SID from `whoami /user /fo csv /nh`).
  - Routes added here: `GET /v1/health` → `{ apiVersion: 1, appVersion }`; `GET /v1/state` → `AppSnapshot`; `POST /v1/token/renew` → `{ token }` (closes every open stream that used the old token).
  - Streams (`ws`): `/v1/events` sends `{ v: 1, kind: 'snapshot', snapshot: AppSnapshot }` on connect, then `StreamMessage` items. `/v1/terminals/<terminalId>` is registered by Task 10. WebSocket auth: subprotocols `orchtopus.v1` and `orchtopus.token.<hex>`; the server selects `orchtopus.v1`.
  - `src/shared/api-types.ts`: `AppSnapshot = { ready: boolean; status: AppStatus; projects: ProjectView[]; sessions: SessionView[] }`, `AppStatus = { cli: { found: boolean; version: string | null; supported: boolean }; agentsReachable: boolean; spoolDamaged: number; vscodeAvailable: boolean }`, `ProjectView` (the fields of `ProjectConfig` from Task 8 without `schemaVersion`), `SessionView` (fields: `id, projectId, task, branch, worktreePath, type: 'feature', state: SessionStateWord, stateReason: string | null, contextPct: number | null, mode: 'auto' | 'manual', model: string | null, effort: string | null, terminal: { id: string | null; status: 'none' | 'attaching' | 'attached' | 'elsewhere' | 'exited' }, createdAt`), `SessionStateWord = 'running' | 'needs-you' | 'idle' | 'stopped' | 'failed'`, `StreamMessage = { v: 1; kind: 'snapshot' | 'project' | 'project-removed' | 'session' | 'session-removed' | 'status'; … }`, `ApiError = { error: string; field?: string }`.
  - `applyStreamMessage(state: ClientState, message: StreamMessage): ClientState` in `client-state.ts` (pure).
  - Preload: `window.orchtopus = { connection(): Promise<{ baseUrl: string; token: string }>; pickFolder(): Promise<string | null> }` typed by `PreloadApi` in `src/shared/preload-api.ts`. IPC channels `orchtopus:connection` and `orchtopus:pick-folder`; handlers in `ipc.ts` refuse a sender whose `senderFrame.url` is not the app origin (or the dev server origin when unpackaged).
  - Renderer: `createApiClient(preload: PreloadApi): ApiClient` with `get/post/delete<T>(path, body?)`, `subscribe(onMessage, onConnection): () => void` (reconnects with backoff 250 ms doubling to 5 s; on a 401 it fetches the connection again once), `openTerminal(terminalId, onData): TerminalSocket`.
  - `e2e/launch.ts`: `launchApp(opts?: { dataDir?: string; claudeHome?: string; env?: Record<string,string> }): Promise<{ app: ElectronApplication; page: Page; dataDir: string }>`; sets `ORCHTOPUS_DATA_DIR` to a new temp folder, `CLAUDE_CONFIG_DIR` to a temp Claude home, `ORCHTOPUS_BACKGROUND_WINDOW=1`, removes `ELECTRON_RUN_AS_NODE` and `ELECTRON_RENDERER_URL`, keeps `colorScheme: null`.

Request rules (in `auth.ts`, all unit-tested):
- `Host` must be exactly `127.0.0.1:<port>`; anything else → 421.
- `Authorization: Bearer <token>` compared with `crypto.timingSafeEqual`; missing or wrong → 401.
- `Origin` absent (hook helper, Node clients) or in `allowedOrigins` (app origin; plus the `ELECTRON_RENDERER_URL` origin when unpackaged); any other → 403. CORS preflight `OPTIONS` answers only for allowed origins with `Access-Control-Allow-Origin: <origin>`, `-Methods: GET, POST, DELETE`, `-Headers: Authorization, Content-Type`.
- `POST` needs `Content-Type: application/json`, body at most 1 MiB → else 415 or 413.
- WebSocket upgrade: the same Host, Origin and token checks before `handleUpgrade`; failures write `HTTP/1.1 401` (or 403, 421) and destroy the socket.
- CSP gains `connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*`. Nothing else changes.

- [ ] **Step 1: Write the failing tests.**
  - `auth.test.ts`: `rejects a foreign Host` (`localhost:<port>`, `evil.test`) with 421; `rejects a missing or wrong token` with 401; `accepts no Origin and the app origin`; `rejects https://evil.test` with 403; `answers CORS preflight only for allowed origins`.
  - `server.test.ts` (real server on port 0 with a temp data folder): `listens on 127.0.0.1 only` (`server.address().address === '127.0.0.1'`); `falls back to a free port when the preferred one is taken`; `writes api.json with the port and removes it on close`; `GET /v1/health with the token returns apiVersion 1`; `rejects a 2 MiB body with 413`; `rejects text/plain with 415`; `POST /v1/token/renew invalidates the old token` (old token → 401, new → 200).
  - `token-file.test.ts`: `creates a 64-hex token once and returns the same on the next call`; `renew writes a different token`; `restrictToCurrentUser leaves one ACE for the current user` (Windows only, `icacls` output).
  - `streams.test.ts`: `event stream sends a snapshot first, then published messages`; `refuses an upgrade without the token subprotocol`; `refuses an upgrade from a foreign origin`; `closes event streams opened with a renewed token`.
  - `client-state.test.ts`: `session message replaces the session by id`; `session-removed drops it`; `snapshot replaces everything`.
  - `csp-meta.test.ts`: the existing equality test passes with the new constant; add `allows only loopback for connect-src`.
- [ ] **Step 2: Run** `npx vitest run src/main/api src/shared/client-state.test.ts` → FAIL.
- [ ] **Step 3: Implement** server (`node:http` plus `ws` `noServer` mode), token and port files, IPC, preload, client, wiring in `index.ts` (store opened at `paths.stateDb`; API started before the window loads; `close()` on `before-quit`). `/v1/state` returns `ready: false` until Task 12's startup sequence sets it.
- [ ] **Step 4: Run** the unit tests → PASS; `npm run check` → exit 0; `npm run e2e` → all M0 tests pass through `e2e/launch.ts`, no console errors (CSP violations would show as console errors).
- [ ] **Step 5: Red check.** Make the Host check accept any host; `auth.test.ts` must fail. Revert.
- [ ] **Step 6: Commit** `feat(api): local API on 127.0.0.1 with per-installation token, event stream and preload bridge`.

**Security notes for the reviewer:** a stale `api.json` after a crash points hooks at a port that another local process could take; the token would reach it. Accepted for M1 because the file is deleted on clean quit and the helper sends only state events; record it in `docs/progress.md` (Task 17) as a known risk for M2, where hooks carry decisions.

---

### Task 4: Hook helper, launcher and spool

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high, **security-reviewer Opus high** (hook helper, launcher).

**Files:**
- Create: `src/hook-helper/index.ts`, `src/hook-helper/spool-append.ts`, `src/shared/hook-envelope.ts`, `src/main/hooks/launcher.ts`, `src/main/hooks/install.ts`, `src/main/spool/import.ts`, `src/main/api/routes/hooks.ts`
- Modify: `electron.vite.config.ts` (main build gets a second input `hook-helper: src/hook-helper/index.ts`, output `out/main/hook-helper.js`, CommonJS, no externals except Node built-ins), `tsconfig.node.json` (include `src/hook-helper/**/*`), `src/main/index.ts` (install on start)
- Test: `src/hook-helper/index.test.ts`, `src/main/hooks/launcher.test.ts`, `src/main/hooks/install.test.ts`, `src/main/spool/import.test.ts`

**Interfaces:**
- Consumes: `DataPaths`, `Store`, `startApiServer` route table (Task 3).
- Produces:
  - `HookEnvelope = { v: 1; id: string; at: string; mode: 'hook' | 'statusline'; hook: string; sessionId: string | null; cwd: string | null; fields: Record<string, string | number | boolean | null> }` and `parseEnvelope(value: unknown): HookEnvelope | null` in `src/shared/hook-envelope.ts`. Kept fields: hooks `source`, `tool_name`, `notification_type`, `reason`, `stop_hook_active`, `permission_mode`; statusline `contextPct` (`context_window.used_percentage`), `fiveHourPct`, `fiveHourResetsAt`, `sevenDayPct`, `sevenDayResetsAt`, `model` (`model.id`); pr-block mode `blocked` (the matched kind, Task 7). Prompt text and `tool_input` are never kept.
  - Helper CLI: `hook-helper.js state` (state hooks), `hook-helper.js statusline`, and from Task 7 `hook-helper.js pr-block`. Entry `runHelper(io: { argv: string[]; stdin: string; dataDir: string; now: () => Date; post: (url: string, token: string, body: string, timeoutMs: number) => Promise<number> }): Promise<{ exitCode: number; stdout: string }>`; the data folder is the parent of the helper's own folder. POST timeout 500 ms; status other than 2xx, a missing port or token file, or any error → `appendToSpool(spoolFile, line)`. State mode always exits 0 with empty stdout, also on unexpected errors. Statusline mode prints `ctx <n> %` or `ctx unknown` before sending.
  - `appendToSpool(file: string, line: string): void`: one `appendFileSync` of `line + '\n'` per call (lines stay under 4 KiB), creates the folder.
  - `renderLauncher(input: { exePath: string; helperPath: string }): string` and `installHookFiles(paths: DataPaths, source: { exePath: string; helperBundle: string }): Promise<void>` (writes both files on every start through a temp file plus rename). Launcher content: `@echo off`, `setlocal DisableDelayedExpansion`, `if not exist "<exe>" exit /b 0`, `if not exist "<helper>" exit /b 0`, `set ELECTRON_RUN_AS_NODE=1`, `"<exe>" "<helper>" %*`, `exit /b %ERRORLEVEL%`; `%` in paths doubled. If T6 chose another form, the launcher follows T6.
  - `importSpool(store: Store, paths: DataPaths): Promise<{ imported: number; duplicates: number; damaged: number }>`: renames `events.jsonl` to `events.importing-<epoch>.jsonl` (retry on `EPERM`/`EBUSY` up to 20 × 25 ms), also picks up leftover `events.importing-*.jsonl` from a crash, imports line by line in order as `hook.received` or `statusline.received` events whose id is the envelope id (duplicates skipped by `Store.append`), writes damaged lines to `damaged\<epoch>.jsonl` and appends one `spool.damaged` event with the count, then deletes the importing file.
  - Route `POST /v1/hooks/events` (body `HookEnvelope`) → 202 for new, 200 for a known id; it appends the event and calls the listener set with `setEnvelopeListener(fn: (e: HookEnvelope) => void)` from `routes/hooks.ts` (Task 11 sets it to `tracker.onEnvelope`).
  - Matching an envelope to a session (route and spool import alike, `matchSession(db, envelope): string | null`): the session whose `claude_session_id` equals `envelope.sessionId`, else the session whose worktree contains `envelope.cwd` (hooks fire before the adapter knows the id, for example `SessionStart`). The event's `session_id` column holds the Orchtopus id or null; the projection updates `last_activity_at`, `last_stop_at`, `context_pct` and `rate_limits` of the matched session.

- [ ] **Step 1: Write the failing tests.**
  - `hook-helper/index.test.ts`: `posts the envelope with the bearer token`; `keeps only the listed fields` (a payload with `prompt` and `tool_input.command` yields neither); `spools when the port file is missing`; `spools when the API answers 500`; `spools after the 500 ms timeout` (fake `post` never resolves; fake timers); `state mode exits 0 on malformed stdin`; `statusline prints ctx 18 % and ctx unknown for null`.
  - `launcher.test.ts`: `renders exit 0 lines for a missing exe and helper`; `doubles % in paths`; `runs the helper and passes its exit code` (Windows: render a launcher whose exe is `process.execPath` and helper a stub that exits 3; `spawnSync('cmd.exe', ['/d','/c', launcher, 'state'])` → status 3); `exits 0 when the helper file is gone`; `works from a data folder named "data dir é"` (Review Focus 2).
  - `install.test.ts`: `rewrites launcher and helper on every call` (change the files, install again, contents restored).
  - `import.test.ts`: `imports lines in order and truncates`; `skips ids already in the store`; `keeps damaged lines in damaged\ and logs spool.damaged with the count`; `imports a leftover importing file from a crash`; `loses nothing while helpers append during import` (Review Focus 5: 4 child processes append 200 envelopes each while `importSpool` runs three times; afterwards the store holds exactly 800 distinct ids and the spool folder holds no importing file).
- [ ] **Step 2: Run** `npx vitest run src/hook-helper src/main/hooks src/main/spool` → FAIL.
- [ ] **Step 3: Implement** the signatures. The helper imports only Node built-ins and `src/shared/hook-envelope.ts` (no zod in the helper bundle, to keep start time low). `installHookFiles` takes `exePath` from `process.execPath` and the helper bundle from `join(__dirname, 'hook-helper.js')`.
- [ ] **Step 4: Run** the unit tests → PASS; `npm run build` → `out/main/hook-helper.js` exists; `npm run check` → exit 0.
- [ ] **Step 5: Timing check.** With the dev build, run the installed launcher 30 times against the running API (`npm run start`, then a small loop in PowerShell with `Measure-Command`). Expected: p95 under 300 ms, same order as T6. Record p50 and p95 in the commit message body.
- [ ] **Step 6: Commit** `feat(hooks): hook helper with spool fallback, stable launcher and spool import`.

---

### Task 5: Git layer: project detection, task names and worktrees

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high.

**Files:**
- Create: `src/main/git/git.ts`, `src/main/git/repo-info.ts`, `src/main/git/remote-url.ts`, `src/main/git/worktrees.ts`, `src/shared/task-name.ts`, `src/main/test-helpers/temp-repo.ts`
- Test: `src/main/git/repo-info.test.ts`, `remote-url.test.ts`, `worktrees.test.ts`, `src/shared/task-name.test.ts`

**Interfaces:**
- Produces:
  - `runGit(args: readonly string[], opts: { cwd: string; timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }>` (`execFile('git', …)`, env adds `GIT_TERMINAL_PROMPT=0`, default timeout 30 s).
  - `inspectRepo(path: string): Promise<RepoInspection>`, `RepoInspection = { ok: true; root: string; defaultBranch: string; currentBranch: string | null; remotes: RemoteInfo[]; provider: 'github' | 'gitlab' | null } | { ok: false; reason: 'not-a-repo' | 'not-top-level' | 'is-worktree' | 'is-bare' | 'git-missing'; message: string }`. Default branch from `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` (strip `origin/`), else the current branch. Worktree: `--git-dir` differs from `--git-common-dir`. Provider from the `origin` host (`github.com` → github; `gitlab.com` or a host containing `gitlab` → gitlab).
  - `RemoteInfo = { name: string; url: string }` where `url` is already stripped; `stripCredentials(url: string): string` in `remote-url.ts`: http(s) loses user and password and the query; `ssh://` loses the password only; scp form (`git@host:path`) stays.
  - `validateTaskName(name: string): string | null` (error text or null): `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1 to 48 characters. `deriveBranch(prefix: string, task: string): string`. Default prefix `DEFAULT_BRANCH_PREFIX = 'orch/'`.
  - `checkNewWorktree(root: string, task: string, branch: string): Promise<string | null>`: unique folder under `.claude/worktrees/`, no `refs/heads/<branch>`, no `refs/remotes/*/<branch>`, `git check-ref-format --branch` passes.
  - `ensureWorktreesExcluded(root: string): Promise<'already-ignored' | 'added' | { refused: string }>`: refuses if `git ls-files -- .claude/worktrees` is not empty; otherwise if `git check-ignore -q .claude/worktrees/probe` fails, appends `/.claude/worktrees/` to the file from `git rev-parse --git-path info/exclude` (creates `info/`), never twice.
  - `resolveBase(root: string, remote: string | null, defaultBranch: string, useLocal: boolean): Promise<{ base: string; fetchFailed: boolean; message?: string }>`: `git fetch --no-tags <remote> <defaultBranch>` with 60 s timeout; on failure returns `fetchFailed: true` and no base (the caller asks the user, then calls again with `useLocal: true`).
  - `createWorktree(input: { root; task; branch; base }): Promise<{ path: string }>`: `git worktree add --no-track -b <branch> <root>/.claude/worktrees/<task> <base>`; idempotent (an existing worktree at that path on that branch is returned as is).
  - `copyIntoWorktree(root: string, worktree: string, list: readonly string[]): Promise<{ copied: string[]; missing: string[]; refused: string[] }>`: refuses absolute paths, `..` segments and anything that resolves outside `root`.
  - `worktreeIsClean(path: string): Promise<boolean>` (`git status --porcelain --untracked-files=normal` empty) and `removeWorktree(root, path): Promise<'removed' | { refused: string }>` (`git worktree remove <path>` without `--force`; never deletes the branch; maps `EBUSY`/"Permission denied" to a message that names open programs).
  - `createTempRepo(opts?: { withRemote?: boolean; dirName?: string }): Promise<{ root: string; remote: string | null; cleanup(): Promise<void> }>` test helper (one commit, `.env` ignored, `.env.example` tracked).

- [ ] **Step 1: Write the failing tests.**
  - `task-name.test.ts`: accepts `upload-fix`, `i18n-de`, `a`; rejects `Upload-Fix`, `upload_fix`, `-x`, `x-`, `a--b`, `""`, 49 characters.
  - `remote-url.test.ts`: `https://x-access-token:FAKE_TOKEN@github.com/acme/acme-app.git` → `https://github.com/acme/acme-app.git`; `https://user@gitlab.com/acme/acme-web.git?private_token=x` → `https://gitlab.com/acme/acme-web.git`; `ssh://git:pw@host/acme.git` → `ssh://git@host/acme.git`; `git@github.com:acme/acme-app.git` unchanged.
  - `repo-info.test.ts`: `detects default branch from origin/HEAD`; `falls back to the current branch without a remote`; `refuses a subfolder as not-top-level`; `refuses a linked worktree`; `refuses a bare repository`; `stores remotes stripped` (Review Focus 4: a remote set with a token; no returned field contains the token); `works on a repository path with a space` (Review Focus 2, `dirName: 'acme app'`).
  - `worktrees.test.ts`: `adds the exclude line once and reports already-ignored next time`; `refuses when a file under .claude/worktrees is tracked`; `leaves the repository unchanged apart from info/exclude and worktree metadata` (snapshot of `git status --porcelain --ignored` and the file list outside `.git` and `.claude/worktrees` before and after); `creates the branch without upstream` (`git config branch.orch/upload-fix.merge` exits 1); `create is idempotent`; `rejects a duplicate task and an existing branch`; `copies .env, reports a missing file, refuses ../outside and C:\\x`; `reports fetchFailed when the remote is gone`; `refuses removal with an untracked file and removes a clean worktree keeping the branch`.
- [ ] **Step 2: Run** `npx vitest run src/main/git src/shared/task-name.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures.
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: Commit** `feat(git): project detection, task name rules and worktree handling`.

---

### Task 6: Claude CLI access, trust and `agents --json`

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high.

**Files:**
- Create: `src/main/claude/cli.ts`, `src/main/claude/claude-home.ts`, `src/main/claude/trust.ts`, `src/main/claude/agents.ts`, `src/main/claude/clean-env.ts`
- Test: `src/main/claude/cli.test.ts`, `claude-home.test.ts`, `trust.test.ts`, `agents.test.ts`, `clean-env.test.ts`

**Interfaces:**
- Produces:
  - `ClaudeCommand = { command: string; prefixArgs: readonly string[] }`. `resolveClaudeCommand(input: { env; packaged: boolean; where: () => Promise<string[]> }): Promise<ClaudeCommand | null>`: when unpackaged and `ORCHTOPUS_CLAUDE_COMMAND` is set, it is a JSON array `[command, ...prefixArgs]` (used for the fake); otherwise the first `.exe` from `where claude`.
  - `runClaude(cmd: ClaudeCommand, args: readonly string[], opts: { cwd: string; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string }>` with `cleanEnv()`.
  - `cleanEnv(base: NodeJS.ProcessEnv): Record<string, string>` dropping the variables listed in Global Constraints.
  - `readClaudeVersion(cmd): Promise<{ version: string | null; supported: boolean }>`; `MIN_CLAUDE_VERSION = '2.1.302'`; `compareVersions(a, b): number`; parses `^(\d+\.\d+\.\d+)`.
  - `claudeConfigPaths(env, home: string): { globalConfig: string; userSettings: string; userClaudeMd: string; userSkills: string }` (honours `CLAUDE_CONFIG_DIR`).
  - `readTrust(globalConfigFile: string, repoRoot: string): Promise<'trusted' | 'not-trusted' | 'unknown'>`: reads only `projects[key].hasTrustDialogAccepted`, where key is the root with forward slashes, matched case-insensitively; unreadable file or missing structure → `unknown`. Never writes.
  - `AgentEntry = { id: string; sessionId: string | null; cwd: string; kind: string; state: string | null; status: string | null; waitingFor: string | null; name: string | null; startedAt: number | null; pid: number | null }`; `parseAgentsJson(stdout: string): AgentEntry[]` (throws `AgentsParseError` on non-JSON); `listAgents(cmd): Promise<AgentEntry[]>` runs `agents --json --all` (no `--cwd`, timeout 5 s) and throws `AgentsListError` (with `cause: 'parse' | 'timeout' | 'spawn' | 'exit'`) for non-JSON output, a timeout, a spawn error or a non-zero exit; `AgentsParseError` is its `parse` case; `filterByCwd(entries, dir): AgentEntry[]` keeps entries whose `cwd` equals or lies under `dir` (slashes and case normalized).

- [ ] **Step 1: Write the failing tests.**
  - `cli.test.ts`: `uses ORCHTOPUS_CLAUDE_COMMAND only when unpackaged`; `picks the first .exe from where`; `returns null when nothing is found`; version `2.1.332 (Claude Code)` → supported; `2.1.301` → not supported; garbage → `{ version: null, supported: false }`.
  - `clean-env.test.ts`: drops `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `ELECTRON_RUN_AS_NODE`, keeps `PATH`, `CLAUDE_CONFIG_DIR`.
  - `claude-home.test.ts`: default paths under home; `CLAUDE_CONFIG_DIR` paths.
  - `trust.test.ts`: `trusted for C:/Repos/acme-app with backslash input`; `not-trusted when false`; `unknown for a missing file, bad JSON, missing projects`; `never opens the file for writing` (spy on `fs.promises.open`/`writeFile`: no write call).
  - `agents.test.ts`: parses the spike's observed entry shape (fields from the spike doc Q1, with `kind: "interactive"` entries that have no `state`); `throws AgentsParseError for "Error: …"`; `filterByCwd matches the worktree and subfolders, not siblings` (`C:\r\.claude\worktrees\upload-fix` vs `…\upload-fix-2`).
- [ ] **Step 2: Run** `npx vitest run src/main/claude` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: Commit** `feat(claude): CLI discovery, version check, trust reader and agents list`.

---

### Task 7: Base setup: settings, PR block and workflow instruction

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high, **security-reviewer Opus high** (PR block hook, deny rules, hook configuration).

**Files:**
- Create: `building-blocks/workflow-instruction.md`, `src/main/base-setup/building-blocks.ts`, `src/main/base-setup/settings.ts`, `src/shared/pr-block.ts`, `tooling/building-blocks.test.ts`
- Modify: `src/hook-helper/index.ts` (mode `pr-block`), `electron-builder.yml` (`extraResources: [{ from: building-blocks, to: building-blocks }]`)
- Test: `src/main/base-setup/settings.test.ts`, `src/shared/pr-block.test.ts`, `src/main/base-setup/building-blocks.test.ts`, `src/hook-helper/index.test.ts` (extended)

**Interfaces:**
- Consumes: `DataPaths`, `sessionFiles` (Task 2), `RemoteInfo` (Task 5), launcher path and invocation form (Task 4, T6).
- Produces:
  - `buildingBlocksDir(packaged: boolean, resourcesPath: string, appRoot: string): string`; `loadBuildingBlock(dir, name): { version: string; body: string }` (front matter `version: x.y.z` on the first lines, stripped); `renderTemplate(body, vars: Record<string,string>): string` (`{{name}}`, unknown name throws).
  - `buildSessionSettings(input: { launcher: HookInvocation; remotes: readonly RemoteInfo[]; projectName: string; denyHomeSsh: string }): ClaudeSettings` and `writeSessionFiles(paths, sessionId, input): Promise<{ settings: string; systemPrompt: string }>` (rewritten on every app start for every live session by Task 12). `HookInvocation = { command: string; args: (mode: 'state' | 'statusline' | 'pr-block') => string[]; statusLine: string }`, produced here by `hookInvocation(paths: DataPaths): HookInvocation` (in `settings.ts`, built from the T6 decision and the launcher path); Task 12 calls it.
  - `detectPrCommand(command: string): { kind: 'gh-pr-create' | 'gh-pr-merge' | 'glab-mr-create' | 'glab-mr-merge' } | null` in `src/shared/pr-block.ts`.
  - Helper mode `pr-block`: reads the `PreToolUse` payload, runs `detectPrCommand(tool_input.command)`; on a match prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<PR_BLOCK_REASON>"}}` and exits 0; no match → empty stdout, exit 0; it never contacts the app. It also spools a `hook.received` envelope with `fields.blocked = '<kind>'` so the app can show it later.
  - `PR_BLOCK_REASON = 'Orchtopus does not let sessions create or merge pull requests or merge requests. Commit and push your branch instead; Orchtopus opens the pull request after the user releases the work.'`

Settings content (exact keys; values in angle brackets come from the input):

```json
{
  "permissions": { "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./secrets/**)", "<T5 form, default Read(~/.ssh/**)>"] },
  "autoMode": { "environment": ["$defaults", "Source control: the git remotes of <projectName> are <stripped urls joined by ', '>; pushing this session's own feature branch there is routine."] },
  "worktree": { "bgIsolation": "none" },
  "statusLine": { "type": "command", "command": "<statusLine>" },
  "hooks": {
    "SessionStart": [{ "hooks": [<STATE_HOOK>] }],
    "UserPromptSubmit": [{ "hooks": [<STATE_HOOK>] }],
    "PostToolUse": [{ "hooks": [<STATE_HOOK>] }],
    "Stop": [{ "hooks": [<STATE_HOOK>] }],
    "SessionEnd": [{ "hooks": [<STATE_HOOK>] }],
    "Notification": [{ "hooks": [<STATE_HOOK>] }],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "<command>", "args": ["<…state>"], "async": true, "timeout": 5 }] },
      { "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "<command>", "args": ["<…pr-block>"], "timeout": 10, "onFailure": "block" }] }
    ]
  }
}
```

(`<STATE_HOOK>` stands for the object shown in the first `PreToolUse` entry; the real file repeats it in full under each of the seven event keys. No `onFailure` on state hooks. Without a remote the environment line reads `Source control: <projectName> has no git remote.` `bgIsolation` follows T1; `async` follows T6.)

Workflow instruction v1 (front matter `version: 1.0.0`; variables `branch`, `defaultBranch`; at most 120 words):

> You work in a git worktree that Orchtopus created for this task, on the branch {{branch}}. Make all changes in this folder. Commit your work on this branch and push the branch when the task is done. Do not create or merge pull requests or merge requests: Orchtopus opens the pull request after the user has reviewed and released the work. Do not push to {{defaultBranch}} and do not switch to another branch.

- [ ] **Step 1: Write the failing tests.**
  - `pr-block.test.ts`: matches `gh pr create --draft`, `gh pr merge 12`, `gh -R acme/acme-app pr create`, `gh.exe pr create`, `cd x && gh pr create`, `glab mr create`, `glab mr merge 3`, `& gh pr create` (PowerShell), `"gh" pr create`; does not match `gh pr list`, `gh pr view 3`, `git commit -m "gh pr create later"`, `echo glab mr`, `ghq pr create`.
  - `settings.test.ts`: `has the four deny rules`; `autoMode environment starts with $defaults and names stripped remotes`; `never contains a credential` (Review Focus 4: remotes given with a token → `JSON.stringify(settings)` has no token); `state hooks have no onFailure and run async`; `PR block hook is PreToolUse on Bash|PowerShell with onFailure block`; `every hook calls the launcher at its fixed path`; `sets worktree.bgIsolation none`; `writeSessionFiles writes both files into sessions\<id>\ and overwrites them`.
  - `building-blocks.test.ts`: front matter is parsed and stripped; unknown template variable throws.
  - `hook-helper/index.test.ts`: `pr-block denies gh pr create with PR_BLOCK_REASON`; `pr-block allows git push with empty stdout`; `pr-block exits non-zero on unreadable stdin` (so `onFailure: "block"` blocks); `pr-block never calls post`.
  - `tooling/building-blocks.test.ts` (D10, runs over every file in `building-blocks/`, so later prompts and skills are covered): `has a version`; `has no emphasis words in capitals` (`/\b(IMPORTANT|MUST|NEVER|ALWAYS|CRITICAL|REQUIRED)\b/`, case-sensitive); `the workflow instruction has at most 120 words`; `every SKILL.md has fewer than 500 lines`; `a SKILL.md with side effects sets disable-model-invocation: true` (side effects declared by `side-effects: true` in its front matter).
- [ ] **Step 2: Run** `npx vitest run src/main/base-setup src/shared/pr-block.test.ts src/hook-helper tooling/building-blocks.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS. **Red check:** add `IMPORTANT:` to the instruction → the D10 test fails; revert. `npm run check` → exit 0.
- [ ] **Step 5: Live check (once, real CLI, scratch `acme-app` from the spike harness):** write settings with `buildSessionSettings` for a scratch session, start `claude --bg --settings <file> --permission-mode auto --model haiku --effort low "Run exactly: gh pr create --draft --title t --body b"`. Expected in `claude logs <id>`: the deny reason, no PR command ran. Record the line in the commit body.
- [ ] **Step 6: Commit** `feat(base-setup): per-session settings, PR block hook and workflow instruction`.

---

### Task 8: Projects: config, detection, setup check and routes

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high.

**Files:**
- Create: `src/main/projects/project-config.ts`, `detect.ts`, `setup-check.ts`, `project-service.ts`, `src/main/api/routes/projects.ts`
- Test: `src/main/projects/project-config.test.ts`, `detect.test.ts`, `setup-check.test.ts`, `project-service.test.ts`

**Interfaces:**
- Consumes: `inspectRepo`, `RemoteInfo` (Task 5); `claudeConfigPaths`, `readTrust`, `readClaudeVersion` (Task 6); `Store`, `ActionRunner`, `projectFile` (Task 2); `RouteTable` (Task 3).
- Produces:
  - `ProjectConfig` (zod schema `projectConfigSchema`, `schemaVersion: 1`): `{ schemaVersion: 1; id: string; name: string; path: string; defaultBranch: string; remotes: RemoteInfo[]; provider: 'github' | 'gitlab' | null; checkCommands: { test: string | null; lint: string | null; typecheck: string | null }; copyList: string[]; branchPrefix: string; lastStart: { model: string | null; effort: string | null; mode: 'auto' | 'manual' } }`. `readProjectConfig(file)`, `writeProjectConfig(file, config)` (temp file plus rename).
  - `detectCheckCommands(root): Promise<ProjectConfig['checkCommands']>`: `package.json` scripts `test`, `lint`, `typecheck` / `type-check` / `check-types`, run through the lockfile's manager (`pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lock`/`bun.lockb` → `bun`, else `npm run <script>`, and `npm test` for `test`); else `Cargo.toml` → `cargo test`, `cargo clippy`; `go.mod` → `go test ./...`, `go vet ./...`.
  - `suggestCopyList(root): Promise<string[]>`: top-level `.env*` files that `git check-ignore` reports as ignored.
  - `SetupItem = { id: SetupItemId; status: 'ok' | 'hint' | 'problem' | 'info'; title: string; detail: string; fix: string | null }` and `runSetupCheck(input: { root: string; checkCommands: ProjectConfig['checkCommands']; cli: { found: boolean; version: string | null; supported: boolean }; claudePaths: ReturnType<typeof claudeConfigPaths>; env: Readonly<Record<string, string | undefined>> }): Promise<SetupItem[]>` (`cli` has the shape of `AppStatus['cli']`, filled from `readClaudeVersion`) with one item per spec row, ids in this order: `claude-version`, `trust`, `check-command`, `claude-md-length`, `claude-md-emphasis`, `secret-deny`, `superpowers`, `auto-memory`, `default-mode`, `skill-length`, `committed-personal-settings`, `prompt-audit`.
  - Item rules: version below 2.1.302 or CLI missing → problem, fix `claude update`; trust `not-trusted` or `unknown` → problem with the trust step offered; no check command → hint; `CLAUDE.md` (project root, `.claude/CLAUDE.md`, user) 200 lines or more → hint naming the file; any `IMPORTANT|YOU MUST|MUST|NEVER|ALWAYS|CRITICAL` in capitals → hint; deny rules in user, project and local settings do not cover `.env`, `.env.*` and `secrets/**` → hint "Orchtopus sessions get these rules anyway"; no `enabledPlugins` key starting with `superpowers@` set to true in user settings → hint, fix `claude plugin install superpowers@claude-plugins-official`; `autoMemoryEnabled: false` in user or project settings or `CLAUDE_CODE_DISABLE_AUTO_MEMORY` set → hint; user `permissions.defaultMode === 'bypassPermissions'` → problem; any `.claude/skills/*/SKILL.md` with 500 lines or more → hint; tracked `.claude/settings.json` with `permissions.defaultMode`, `model` or `effortLevel` → hint; prompt audit → info "Run /doctor prompt-audit in Claude Code to review your prompts". Every read is best effort: an unreadable settings file makes its item a hint that says so.
  - `createProjectService(deps): ProjectService` with `inspect(path): Promise<InspectResult>` (no writes), `add(input: AddProjectInput, actionId?): Promise<ProjectView>`, `remove(projectId): Promise<void>` (refused with 409 while the project has sessions; removes `project.json` and logs `project.removed`; never touches the repository), `setupCheck(projectId): Promise<SetupItem[]>`, `rememberStart(projectId, lastStart): Promise<void>`. `InspectResult = { repo: RepoInspection; checkCommands; copyList: string[]; branchPrefix: string; trust: 'trusted' | 'not-trusted' | 'unknown'; setup: SetupItem[] }`.
  - Routes: `POST /v1/projects/inspect { path }`, `POST /v1/projects { path, checkCommands, copyList, branchPrefix, requestId }`, `DELETE /v1/projects/:id`, `POST /v1/projects/:id/setup-check`. Each publishes `project` / `project-removed` stream messages.

- [ ] **Step 1: Write the failing tests.**
  - `project-config.test.ts`: round trip; `rejects schemaVersion 2`; `rejects a copyList entry with ..`.
  - `detect.test.ts`: npm, pnpm, yarn, cargo and go fixtures (temp folders); `suggests .env and .env.local, not tracked .env.example`.
  - `setup-check.test.ts`: one test per item for each status it can take, with temp Claude homes and repos; `returns the items in the fixed order`; `an unreadable user settings file gives hints, not a throw`.
  - `project-service.test.ts`: `inspect writes nothing` (data folder and repo unchanged); `add logs project.added before writing project.json and is idempotent by requestId`; `remove refuses while sessions exist`; `remove deletes the config, never the repository`.
- [ ] **Step 2: Run** `npx vitest run src/main/projects` → FAIL.
- [ ] **Step 3: Implement** and register the routes in `src/main/index.ts`.
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: Commit** `feat(projects): add project, detection and read-only setup check`.

---

### Task 9: Fake `claude` CLI for tests and CI

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high.

**Files:**
- Create: `tooling/fake-claude/cli.mjs`, `tooling/fake-claude/worker.mjs`, `tooling/fake-claude/store.mjs`, `tooling/fake-claude/scenarios/basic.json`, `tooling/fake-claude/scenarios/pr-attempt.json`, `tooling/fake-claude/scenarios/needs-you.json`
- Test: `tooling/fake-claude/cli.test.ts`

**Interfaces:**
- Produces: run as `node tooling/fake-claude/cli.mjs <args>`; adapter and e2e point `ORCHTOPUS_CLAUDE_COMMAND` at `["<node>", "<repo>/tooling/fake-claude/cli.mjs"]`. State lives in `$ORCH_FAKE_CLAUDE_HOME` (default `$CLAUDE_CONFIG_DIR/fake`). Scenario from `$ORCH_FAKE_SCENARIO` (default `basic`).
  - `--version` → `2.1.332 (Claude Code)`.
  - `--bg [--settings f] [--append-system-prompt-file f] [--permission-mode m] [--name n] [--model m] [--effort e] [prompt]` and `--bg --resume <uuid>`: needs trust (`$CLAUDE_CONFIG_DIR/.claude.json`, same key rule as the real CLI) else prints `Workspace not trusted` and exits 1; spawns `worker.mjs` detached (`detached: true`, `stdio: 'ignore'`, `unref()`), prints `backgrounded · <id> · <name>`, exits 0. A resume keeps the saved options (like R1).
  - `worker.mjs`: writes `<home>/sessions/<id>.json` (`id`, `sessionId`, `cwd`, `kind: 'background'`, `startedAt`, `name`, `state`, `status`, `waitingFor`, `pid`, saved options); plays the scenario steps (`{ at: ms, state, status, waitingFor?, hook?: { event, payload }, statusline?: { contextPct }, output?: string }`), and for each `hook` runs every matching command hook from the settings file exactly as the real CLI would (exec form, JSON on stdin, honours `matcher`, waits for sync hooks, does not wait for `async`), printing the PR block's deny reason to its output log when a `pr-block` hook denies; listens on a named pipe `\\.\pipe\orch-fake-<id>` for attach clients.
  - `agents --json [--all] [--cwd p]` → JSON array of the session files (`--all` includes `done`/`stopped`; a dead worker pid turns `working` into `failed`).
  - `attach <id>`: connects to the worker pipe, replays the output so far, then streams; prints a prompt box line `╭─ fake prompt ─╮` after 300 ms; typed lines are echoed as `> <line>` and answered with `fake reply: <line>`; when a newer attach connects to the same worker, the older one prints `Session opened in another window` and exits 0.
  - `stop <id>` → kills the worker, sets `state: 'done'`, `status` absent. `rm <id>` removes the file.
  - Plain `claude` (no args) in a folder: prints a trust question `Do you trust the files in this folder? 1. Yes 2. No`; `1` + Enter writes `hasTrustDialogAccepted: true` for the folder and shows the prompt box; `/exit` exits 0.
  - `--fake-cleanup` kills every worker in the home and deletes it (used by tests and e2e teardown).

- [ ] **Step 1: Write the failing test** `cli.test.ts` (Vitest, real child processes, temp homes): `prints the version`; `refuses --bg in an untrusted folder`; `starts a background session that agents --json lists with a sessionId`; `--cwd filters by folder`; `runs a PreToolUse hook from --settings and logs a deny`; `stop turns the entry into done without status`; `resume keeps the saved options`; `a second attach takes the session over`; `the worker survives the death of the cli process`; `trust prompt writes the trust key`.
- [ ] **Step 2: Run** `npx vitest run tooling/fake-claude` → FAIL.
- [ ] **Step 3: Implement** (plain ESM JavaScript, Node built-ins only; ESLint covers it with type checks off).
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: Commit** `test: fake claude CLI with scripted background sessions`.

---

### Task 10: Background adapter, attach terminals and terminal stream

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high, **security-reviewer Opus high** (terminal stream on the local API, PTY spawning).

**Files:**
- Create: `src/main/adapter/agent-adapter.ts`, `src/main/adapter/background-adapter.ts`, `src/main/adapter/attach-terminal.ts`, `src/main/adapter/terminals.ts`, `src/main/api/routes/terminals.ts`
- Test: `src/main/adapter/background-adapter.test.ts`, `attach-terminal.test.ts`, `terminals.test.ts`

**Interfaces:**
- Consumes: `ClaudeCommand`, `runClaude`, `listAgents`, `filterByCwd`, `cleanEnv` (Task 6); `ApiServer.registerTerminalStream` (Task 3); fake CLI (Task 9).
- Produces:
  - `AgentAdapter` (the only Claude Code surface for the rest of the app):
    ```ts
    interface AgentAdapter {
      start(input: StartInput): Promise<StartedSession>;
      list(): Promise<AgentEntry[]>;
      resume(ref: SessionRef): Promise<void>;
      stop(ref: SessionRef): Promise<void>;
      attach(ref: SessionRef, size: { cols: number; rows: number }): Promise<TerminalHandle>;
      openPlain(cwd: string, size: { cols: number; rows: number }): Promise<TerminalHandle>; // trust step
    }
    type StartInput = { cwd: string; settingsFile: string; systemPromptFile: string; name: string;
      mode: 'auto' | 'manual'; model: string | null; effort: string | null; prompt: string | null;
      agentsJson: string | null; pluginDirs: readonly string[] };
    type StartedSession = { sessionId: string; shortId: string };
    type SessionRef = { sessionId: string; shortId: string };
    ```
  - `createBackgroundAdapter(deps: { cmd: ClaudeCommand; now: () => number; sleep: (ms: number) => Promise<void> }): AgentAdapter`. Start args in this order: `--bg --settings <f> --append-system-prompt-file <f> [--agents <json>] [--plugin-dir <d>]… [--model <m>] [--effort <e>] --permission-mode <auto|manual> --name <task> [prompt]`. After exit 0 it polls `list()` every 500 ms for up to 15 s for a `background` entry under `cwd` with `startedAt` at or after the start time and a `sessionId`; none → throws `StartError('session id not found')`; non-zero exit → `StartError(stderr first line)`. `resume` runs `--bg --resume <uuid>` with no other flag. `stop` runs `stop <shortId>`. Spawn style (plain or detached) follows T4.
  - `TerminalHandle = { id: string; ready: Promise<void>; write(data: string): void; resize(cols: number, rows: number): void; onData(cb: (chunk: string) => void): () => void; onExit(cb: (info: { code: number; elsewhere: boolean }) => void): () => void; replay(): string; dispose(): void }`. `attach` spawns node-pty `attach <shortId>` (ConPTY, clean env, cwd of the session). Writes before `ready` are queued; `ready` resolves at the first 500 ms of output silence after the first output, or after 6 s. `replay()` returns the last 512 KiB. `elsewhere` is true when the output's tail contains `Session opened in another window`.
  - `createTerminalRegistry(adapter): TerminalRegistry` with `openForSession(sessionId, ref, size): Promise<string>` (one handle per session; a second call returns the same id while it lives), `openTrust(cwd, size): Promise<string>`, `get(id)`, `closeAll()`; it publishes the terminal status into `SessionView.terminal` through a callback.
  - Terminal stream `/v1/terminals/<id>`: on connect the server sends `replay()` as one binary frame, then live chunks as binary frames; client text frames `{ "type": "input", "data": string }` (max 64 KiB) and `{ "type": "resize", "cols": 1..500, "rows": 1..300 }`, validated with zod; anything else closes the socket with 1008. Several stream clients may watch one handle; input from any goes to the one PTY.
  - Routes: `POST /v1/terminals/trust { path }` → `{ terminalId }`; `DELETE /v1/terminals/:id` (trust terminals only: writes `/exit\r`, kills after 5 s).

- [ ] **Step 1: Write the failing tests** (against the fake CLI through `ORCHTOPUS_CLAUDE_COMMAND`-style `ClaudeCommand`, temp homes, trusted temp folders):
  - `background-adapter.test.ts`: `passes the flags in order and omits unset model, effort and prompt` (fake records argv); `never passes --session-id or bypassPermissions`; `reads the session id from agents --json`; `throws StartError when the folder is not trusted`; `resume passes no flag besides --bg --resume`; `stop uses the short id`.
  - `attach-terminal.test.ts`: `queues input until ready`; `replay returns earlier output to a late subscriber`; `reports elsewhere when another attach takes over` (Review Focus 3: second fake attach; first handle exits with `elsewhere: true`); `dispose leaves the session running` (fake `agents --json` still lists it as working).
  - `terminals.test.ts`: `one handle per session`; `the stream replays then streams`; `rejects an oversize input frame with 1008`; `does not reopen a handle that ended elsewhere` (registry status `elsewhere`, no new spawn until `openForSession` is called again by the user's action).
- [ ] **Step 2: Run** `npx vitest run src/main/adapter` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: Commit** `feat(adapter): background-session adapter with app-owned attach terminals`.

---

### Task 11: Session state rules, tracker and poller

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high.

**Files:**
- Create: `src/main/sessions/state-rules.ts`, `src/main/sessions/state-tracker.ts`, `src/main/sessions/agents-poller.ts`
- Test: `src/main/sessions/state-rules.test.ts`, `state-tracker.test.ts`, `agents-poller.test.ts`

**Interfaces:**
- Consumes: `AgentEntry`, `AgentsParseError` (Task 6); `Store`, projections (Task 2); `HookEnvelope` (Task 4); `ApiServer.publish` (Task 3).
- Produces:
  - Constants: `POLL_INTERVAL_MS = 1000`, `ACTIVITY_WINDOW_MS = 3000`, `STALE_AFTER_STOP_MS = 3000`, `START_GRACE_MS = 10000`.
  - `deriveState(input: StateInput): { word: SessionStateWord; reason: string | null }` with `StateInput = { now: number; observed: { state: string | null; status: string | null; waitingFor: string | null } | 'missing' | 'unknown'; lastActivityAt: number | null; lastStopAt: number | null; processStartedAt: number | null; starting: boolean; startFailed: string | null; previous: SessionStateWord }`. Rules, first match wins:
    1. `startFailed` → failed (reason = it). It stays until a later successful start or resume clears it, so polls that find no entry cannot turn it into stopped.
    1a. `starting` (a `session.start` or `session.open` action for this session is pending) → running, reason "Starting". It wins over `missing` and `unknown`, because there is no agents entry before `claude --bg` returns.
    2. `unknown` (no successful poll yet, or the last poll failed) → `previous`.
    3. `missing` → stopped.
    4. `failed` → failed ("Claude Code reports the session failed").
    5. `stopped`, or `done` with no `status` → stopped.
    6. `blocked` (any status) → needs-you (reason `waitingFor` when set).
    7. `working` / `busy`, or `working` with no `status` → running.
    8. `working` / `idle`: running if `processStartedAt` is within `START_GRACE_MS` and no Stop came after it; idle if a Stop came and no hook or statusline event followed it for `STALE_AFTER_STOP_MS`; otherwise running.
    9. `done` / `idle`: running if a non-Stop hook event (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionStart`) arrived after the last Stop and within `ACTIVITY_WINDOW_MS`; otherwise idle.
    10. anything else → `previous`.
  - `createStateTracker(deps: { store: Store; publish: (m: StreamMessage) => void; now: () => number }): StateTracker` with `onPoll(result: { ok: true; entries: AgentEntry[] } | { ok: false; error: string })`, `onEnvelope(envelope: HookEnvelope)`, `onStartBegun(sessionId)` (sets `starting`), `onProcessStarted(sessionId)` (sets `processStartedAt`, clears `starting` and `startFailed`), `onStartFailed(sessionId, reason)` (clears `starting`, sets `startFailed`), `tick()`. `starting` and `startFailed` are kept in `session_state` (columns `starting INTEGER`, `start_failed TEXT`, added to Task 2's migration 1), so they survive a restart; Task 12's startup clears `starting` for actions it does not resume. It matches entries to stored sessions by `sessionId`, appends `session.observed` only when the observed triple changes and `session.state` only when the word or reason changes, keeps `contextPct` (null after a `SessionStart` with `source` `startup` or `resume` until the next statusline value), and publishes `session` and `status` messages. A failed poll sets `status.agentsReachable = false` and changes no word.
  - `createAgentsPoller(deps: { list: () => Promise<AgentEntry[]>; tracker: StateTracker; intervalMs: number }): { start(): void; stop(): void; pollNow(): Promise<void> }`: one poll in flight at most; a tick during a poll is skipped.

- [ ] **Step 1: Write the failing tests.**
  - `state-rules.test.ts`: one `it` per spec table row and per rule above, including the spike cases: `working/idle right after start is running`; `working/idle 3 s after Stop with no event is idle`; `working/idle after Esc with later PostToolUse stays running`; `blocked/idle is needs you`; `blocked/waiting permission prompt is needs you with reason`; `done without status after claude stop is stopped`; `missing from agents is stopped`; `failed is failed`; `start failure wins`.
  - `state-tracker.test.ts` (fake clock, temp store): `shows a change within 2 s` (entry changes at t=0; the `session` message is published before t=2000 with polls every 1000 ms; N2); `writes session.state only on change`; `keeps last state when a poll fails` (Review Focus 1: a running session, then `onPoll({ ok: false })` five times → word still running, `agentsReachable` false, then a good poll restores `true`); `context is unknown after a new process until a statusline value`; `ignores agents entries that no stored session has`; `a failed start stays failed across polls` (`onStartFailed`, then three polls without an entry → failed with the reason); `a start in progress shows running across polls` (`onStartBegun`, three polls without an entry → running, reason "Starting"; `onProcessStarted` then follows the entry).
  - `agents-poller.test.ts`: `skips a tick while a poll is in flight`; `turns each AgentsListError cause into ok false` (`it.each` over parse, timeout, spawn, exit; Review Focus 1).
- [ ] **Step 2: Run** `npx vitest run src/main/sessions` → FAIL.
- [ ] **Step 3: Implement**; register `tracker.onEnvelope` with the hooks route from Task 4.
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: Commit** `feat(sessions): state rules from agents list, hooks and status line`.

---

### Task 12: Session service, session routes and the restart sequence

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high.

**Files:**
- Create: `src/main/sessions/session-service.ts`, `src/main/api/routes/sessions.ts`, `src/main/startup.ts`
- Modify: `src/main/index.ts` (call `runStartup` before the renderer shows sessions; `closeAll` terminals and stop the poller on quit)
- Test: `src/main/sessions/session-service.test.ts`, `src/main/startup.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 11.
- Produces:
  - `createSessionService(deps): SessionService` with:
    - `start(input: StartSessionInput, actionId?: string): Promise<SessionView>`; `StartSessionInput = { projectId; task; branch; base: 'remote' | 'local'; prompt: string | null; model: string | null; effort: string | null; mode: 'auto' | 'manual'; requestId: string }`. Logged action `session.start` with steps `validate` → `exclude` (`ensureWorktreesExcluded`) → `base` (`resolveBase`; `fetchFailed` ends the action with result `{ fetchFailed: true, message }`, which the route returns as 409 `{ error, field: 'base' }`) → `worktree` (`createWorktree`) → `copy` (`copyIntoWorktree`; missing files become a hint in the result) → `files` (`writeSessionFiles`) → `takeover-check` (`filterByCwd(list(), worktree)`; a found session is adopted and the start step is skipped) → `claude-bg` (`adapter.start`) → `record` (`session.started` with ids). `session.created` is logged at `worktree`, followed at once by `tracker.onStartBegun(id)`; after `record` it calls `tracker.onProcessStarted(id)`. On error it calls `tracker.onStartFailed(id, reason)` (the tracker writes the failed state; the service never writes `session.state` itself); the worktree stays. Calls `rememberStart`.
    - `open(sessionId, size): Promise<{ terminalId: string }>`: stopped, or failed on the Claude Code side (also after a reboot) → `adapter.resume` first (action `session.open`, with `onStartBegun` before and `onProcessStarted` or `onStartFailed` after), then `openForSession`. A session whose own start failed before `claude --bg` has no Claude session id; open then answers 409 "This session never started; remove it and start again".
    - `stop(sessionId): Promise<void>` (action `session.stop`, `adapter.stop`), `remove(sessionId, confirm: true): Promise<void>` (action `session.remove`: stop if not stopped, dispose its terminal, `worktreeIsClean` else refuse 409 with the message, `removeWorktree`, `session.removed`; the branch stays).
    - `reveal(sessionId, target: 'explorer' | 'vscode'): Promise<void>` (`shell.openPath(worktree)`; VS Code through `shell.openExternal('vscode://file/' + encodeURI(forwardSlashPath))`); `vscodeAvailable(): Promise<boolean>` (`where code` exit 0, cached).
  - Routes: `POST /v1/sessions` (`StartSessionInput`, idempotent by `requestId`), `POST /v1/sessions/:id/open { cols, rows }`, `POST /v1/sessions/:id/stop`, `DELETE /v1/sessions/:id { confirm: true }`, `POST /v1/sessions/:id/reveal { target }`. Validation errors are 422 `{ error, field }` (task name, branch, uniqueness). If T3 failed, `prompt` is required.
  - `runStartup(deps): Promise<void>` in this order: open store → `installHookFiles` → rewrite `writeSessionFiles` for every non-removed session → `importSpool` → start API (port file) → `importSpool` again → `readClaudeVersion` → one `pollNow()` → `tracker.tick()` (sessions not found are stopped) → resume pending actions from the log (`session.start` continues from its next step, at most 2 attempts, then failed with "Start was interrupted twice"; `session.stop` and `session.remove` re-run; never removes a worktree with changes) → poller `start()` → snapshot `ready: true`.
  - Window close quits the app (existing `window-all-closed`); sessions keep running.

- [ ] **Step 1: Write the failing tests** (fake CLI, temp repo with remote, temp data folder and Claude home):
  - `session-service.test.ts`: `start creates the worktree, files and a running session`; `start logs action.started before git worktree add runs` (spy order); `start with the same requestId twice starts one session`; `start reports fetchFailed and starts from local after confirmation`; `start refuses a tracked .claude/worktrees file`; `interrupted after claude-bg adopts the session found by cwd` (crash simulated after the `claude-bg` step; resume finds the fake session and records it without a second `--bg`); `open resumes a stopped session without flags, then attaches`; `open resumes a failed session (reboot case) the same way` (fake entry set to `failed`); `a failed start keeps its red state and reason after the next polls`; `remove refuses a dirty worktree and keeps everything`; `remove stops, closes the terminal and removes a clean worktree, branch kept` (the attached PTY is disposed before `git worktree remove`, so Windows does not report the folder busy).
  - `startup.test.ts`: `imports spooled events before the first poll`; `marks sessions missing from agents as stopped`; `continues a pending start from its next step`; `gives up after two interrupted starts`; `rewrites settings files for live sessions`; `sets ready only at the end`.
- [ ] **Step 2: Run** `npx vitest run src/main/sessions/session-service.test.ts src/main/startup.test.ts` → FAIL.
- [ ] **Step 3: Implement** and wire into `index.ts`.
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: Commit** `feat(sessions): start, open, stop and remove as logged actions; restart sequence`.

---

### Task 13: App shell: title bar, session list, status bar and empty states

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high, **ui-reviewer Sonnet high** with an **unslop pass**.

**Files:**
- Create: `src/renderer/state/store.ts`, `src/renderer/components/TitleBar.tsx`, `AppLayout.tsx`, `SessionList.tsx`, `SessionRow.tsx`, `Lamp.tsx`, `StatusBar.tsx`, `EmptyState.tsx`, `ProjectMenu.tsx`, `src/renderer/components.css`, `src/shared/state-words.ts`
- Modify: `src/renderer/App.tsx`, `src/renderer/main.tsx`, `src/renderer/index.html` (link `components.css`), `src/renderer/app.css`, `src/main/window-options.ts` (`titleBarStyle: 'hidden'`, `titleBarOverlay: { color: surface.page, symbolColor: text.primary, height: size.titlebar }` from tokens; `minWidth` 1100, `minHeight` 700), `src/main/index.ts` (`setTitleBarOverlay` on `nativeTheme` update), `package.json` (base-ui, react-resizable-panels, zustand, lucide-react)
- Test: `src/shared/state-words.test.ts`, `src/main/window-options.test.ts` (extended), `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `createApiClient`, `applyStreamMessage`, `AppSnapshot`, `SessionView`, `ProjectView` (Task 3); routes from Tasks 8 and 12.
- Produces:
  - `STATE_LABEL: Record<SessionStateWord, string>` = `running` "running", `needs-you` "needs you", `idle` "idle", `stopped` "stopped", `failed` "failed"; `STATE_SIGNAL: Record<SessionStateWord, 'running' | 'permission' | 'idle' | 'danger'>` (stopped uses idle with a hollow lamp, failed uses danger); `countStates(sessions): { word: SessionStateWord; count: number }[]` (fixed order needs you, running, failed, idle, stopped; zero counts left out).
  - zustand store `useAppStore` with `{ connection: 'connecting' | 'connected' | 'lost'; state: ClientState; selectedSessionId: string | null; select(id) }`.
  - Layout per `DESIGN.md` section 5 in the plain variant (no scenery in M1): title bar 48 (brand, project breadcrumb, a one-line note "1 session needs you" or nothing), session list 264 (resizable 224 to 360 with react-resizable-panels, size persisted with `autoSaveId`), main column, status bar 32 (state counts with lamps and words, "API connected" / "API connection lost" / "Claude Code not reachable" / "Claude Code 2.1.301 is too old (needs 2.1.302)", spool notice "1 damaged spool line kept" when `spoolDamaged > 0`).
  - Session list grouped by project (project name, `⋯` menu with "Run setup check" and "Remove from Orchtopus"), rows with lamp, task name and state word; selection by click and by arrow keys; buttons "+ Session" per project and "+ Project" at the bottom.
  - Empty states: no project → one action "Add a project"; project without sessions → one action "Start a session". Before `ready` the list shows "Loading sessions".

- [ ] **Step 1: Write the failing tests.**
  - `state-words.test.ts`: every word has a label and a signal; `countStates` order and omission of zeros.
  - `window-options.test.ts`: overlay colours come from `surface.page` and `text.primary` per mode; min size 1100 × 700.
  - `e2e/shell.spec.ts` (fake CLI via `launchApp`): `shows the no-project empty state with one action`; `status bar says API connected`; `no console errors and no CSP violations`; `both colour modes paint panel and text tokens`; `every lamp has a text label next to it` (each `[data-lamp]` has a sibling with non-empty text).
- [ ] **Step 2: Run** `npx vitest run src/shared/state-words.test.ts src/main/window-options.test.ts` and `npm run e2e` → FAIL.
- [ ] **Step 3: Implement.** Styles in `components.css` with tokens only; icons from lucide-react at 16/14/12 with stroke 1.5; no motion beyond DESIGN section 9 (lamp colour crossfade 200 ms, count rise 4 px; none for keyboard actions; reduced motion respected).
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0; `tooling/design-token-usage.test.ts` passes (no hard-coded colours).
- [ ] **Step 5: UI review.** Run the unslop checklist on the shell in light and dark mode at 1440 × 900 and 1100 × 700; fix findings; the ui-reviewer checks tokens, contrast and signal colours.
- [ ] **Step 6: Commit** `feat(ui): app shell with session list, status bar and empty states`.

---

### Task 14: Session header and terminal view

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high, **ui-reviewer Sonnet high** with an **unslop pass**, **security-reviewer Opus high** only if the CSP must change.

**Files:**
- Create: `src/renderer/components/SessionHeader.tsx`, `TerminalView.tsx`, `ConfirmRemoveDialog.tsx`, `src/renderer/terminal/xterm-theme.ts`
- Modify: `src/renderer/app.css` (`@import '@xterm/xterm/css/xterm.css';` so Vite emits it into the linked stylesheet), `package.json` (xterm and addons)
- Test: `e2e/session-view.spec.ts`

**Interfaces:**
- Consumes: `ApiClient.openTerminal`, routes `open`, `stop`, `DELETE`, `reveal` (Task 12); `SessionView.terminal` (Task 10).
- Produces:
  - Session header (64): task name, lamp and state word, branch in mono, "ctx 18 %" or "ctx unknown", state reason when failed; buttons Explorer, VS Code (only when the API reports `vscodeAvailable`), Stop (when running, idle or needs you), and a `⋯` menu with "Remove session" (opens `ConfirmRemoveDialog`: names the worktree folder, says the branch is kept, primary "Remove", Esc cancels; a 409 shows its message in the dialog).
  - Terminal (fills the rest): xterm with fit, unicode11 and webgl addons (DOM renderer if webgl fails), theme from computed CSS variables (`--surface-terminal`, `--text-terminal`, `--font-mono`, `--type-small`/`--leading-small`), no smooth scroll. Opening a session calls `POST /open` once, then the stream; input and resize go over the stream. Terminal status `elsewhere` shows "Opened in another window" and a Reattach button; `exited` shows "Terminal closed" and Reattach. Selecting another session keeps the PTY attached (spec: stays attached until quit).
  - `buildXtermTheme(read: (name: string) => string): ITheme` (pure; `src/renderer/terminal/xterm-theme.ts`).

- [ ] **Step 1: Write the failing e2e tests** `session-view.spec.ts` (fake CLI, a project added through the API in `beforeAll`): `opening a session shows the replayed output and the prompt box`; `typed text reaches the session and the reply appears`; `stop changes the word to stopped within 2 s`; `opening a stopped session resumes it and shows the terminal`; `opening a failed session after a reboot resumes it the same way`; `remove asks for confirmation and removes the row`; `a takeover shows Opened in another window and Reattach` (Review Focus 3, the test runs a second fake attach); `no CSP violations while the terminal renders` (collect `securitypolicyviolation` events through `page.evaluate` before opening).
- [ ] **Step 2: Run** `npm run e2e -- session-view` → FAIL.
- [ ] **Step 3: Implement.** If xterm or base-ui needs `style-src 'unsafe-inline'` (an injected `<style>` element), stop and report to the lead with the console text; do not change the CSP without a security review.
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: UI review** as in Task 13 (header states: running, needs you, idle, stopped, failed with reason; terminal states: attaching, attached, elsewhere, exited).
- [ ] **Step 6: Commit** `feat(ui): session header and live terminal`.

---

### Task 15: Add-project and new-session dialogs

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high, **ui-reviewer Sonnet high** with an **unslop pass**.

**Files:**
- Create: `src/renderer/components/AddProjectDialog.tsx`, `SetupChecklist.tsx`, `TrustStep.tsx`, `NewSessionDialog.tsx`, `SetupCheckDialog.tsx`, `src/shared/new-session-form.ts`
- Test: `src/shared/new-session-form.test.ts`, `e2e/dialogs.spec.ts`

**Interfaces:**
- Consumes: routes from Tasks 8, 10 and 12; `validateTaskName`, `deriveBranch` (Task 5); `window.orchtopus.pickFolder()` (Task 3).
- Produces:
  - Add-project dialog (base-ui Dialog): path field plus "Browse" (preload picker); "Check" calls `inspect`; refusals (`not-top-level`, `is-worktree`, `is-bare`, `not-a-repo`) shown as one message; detected default branch, remotes (stripped) and provider shown read-only; check commands (three editable fields, each clearable), copy list (editable list), branch prefix (default `orch/`); `SetupChecklist` with status word and icon per item and a copy button for each `fix`; `TrustStep` when trust is not `trusted`: button "Trust in Claude Code" opens a terminal in the dialog (`POST /v1/terminals/trust`), explains that Claude Code asks and the user answers there; when the trust becomes `trusted` (re-`inspect` every 2 s while open) Orchtopus closes the terminal; a "Close terminal" button is always there. Primary "Add project" stays enabled when trust is a problem (the checklist shows it, and a later start fails with the trust message); Esc cancels.
  - Setup check dialog from the project menu: the same `SetupChecklist` from `POST /setup-check`.
  - New-session dialog: task (live `validateTaskName` error), branch (derived until edited), base (select "origin/<default> (fetch first)" or "<default> (local)"; without a remote only local), first prompt (optional unless T3 failed), model (select: Default, opus, sonnet, haiku), effort (Default, low, medium, high, xhigh, max), mode (segmented Auto / Manual); model, effort and mode start from `project.lastStart`. A 409 `fetchFailed` shows "Fetch failed: <message>. Start from the local branch?" with "Start from local", which sends the start again with `base: 'local'` and a new `requestId` (the first one's stored result is the fetch failure and would come back unchanged). A 422 shows its message under its field. If T2 failed: a trust step for the new worktree folder before the start.
  - `newSessionFormState(input: { task; branchEdited: boolean; branch; prefix }): { branch: string; taskError: string | null; canSubmit: boolean }` (pure).

- [ ] **Step 1: Write the failing tests.**
  - `new-session-form.test.ts`: branch follows the task until edited; invalid task blocks submit; edited branch stays.
  - `e2e/dialogs.spec.ts` (fake CLI; folder picker replaced with `app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repo] }) })`): `refuses a subfolder with a clear message`; `shows every setup item with a word`; `trust step trusts an untrusted demo repo through the terminal and closes it`; `adds acme-app and shows the project empty state`; `new session derives orch/upload-fix and starts it`; `fetch failure offers start from local and the second request carries a new requestId` (the start succeeds from the local branch); `a duplicate task name shows an error under the task field`; `remembers model, effort and mode for the next start`.
- [ ] **Step 2: Run** `npx vitest run src/shared/new-session-form.test.ts` and `npm run e2e -- dialogs` → FAIL.
- [ ] **Step 3: Implement.** Keyboard: every control reachable, Enter submits, Esc cancels, focus ring on `:focus-visible`.
- [ ] **Step 4: Run** → PASS; `npm run check` → exit 0.
- [ ] **Step 5: UI review** as in Task 13 (dialogs in both modes; long remote URLs and long check commands truncate with the full text in a tooltip).
- [ ] **Step 6: Commit** `feat(ui): add-project dialog with setup check and trust step, new-session dialog`.

---

### Task 16: End-to-end walking skeleton against the fake CLI

**Agent:** implementer Opus medium. Reviews: spec-reviewer Sonnet medium, code-reviewer Opus high.

**Files:**
- Create: `e2e/walking-skeleton.spec.ts`, `e2e/fixtures/demo-repo.ts`
- Modify: `e2e/launch.ts` (teardown runs `fake-claude --fake-cleanup`), `playwright.config.ts` (timeout 120 s for this file only if needed), `.github/workflows/ci.yml` only if a new npm script is needed (none expected: `npm run e2e` already runs every spec)

**Interfaces:**
- Consumes: everything; `createDemoRepo(): Promise<{ root; remote; cleanup }>` (an `acme-app` repo with a bare remote, one commit, ignored `.env`, `package.json` with `test` and `lint` scripts).

The test is serial and follows the spec's "Done when" list:

- [ ] **Step 1: Write the test** `walking-skeleton.spec.ts`:
  1. `adds acme-app through the dialog and shows the checklist` (Done 1).
  2. `starts upload-fix with a first prompt and shows live output and running within 2 s` (Done 2, 3). The worktree exists at `<repo>/.claude/worktrees/upload-fix` on `orch/upload-fix`.
  3. `the PR attempt scenario is blocked by the hook` (scenario `pr-attempt`: the fake worker runs the PR block hook for `gh pr create --draft`; the terminal shows `PR_BLOCK_REASON`; the fake records no PR command as run) (Done 5).
  4. `quits mid-turn, events arrive while closed, restart shows state and live terminal` (Done 4): `app.close()` while the fake is `working`; the fake emits hook events and finishes the turn while the app is closed (they land in the spool); relaunch with the same data folder; the row shows idle within 2 s of the window showing sessions; the store has the spooled event ids (`GET /v1/state` plus a direct read of `state.db` with better-sqlite3 for `hook.received` rows); opening the session replays output and accepts input.
  5. `killed app (TerminateProcess) keeps the session and recovers` (Done 4): `process.kill(app.process().pid)`; relaunch; same checks as 4.
  6. `the repository changed only by one exclude line and worktree metadata` (Done 6): compare the demo repo before and after (file list outside `.git` and `.claude/worktrees`, `git status --porcelain --ignored`, `.git/info/exclude` diff is exactly `/.claude/worktrees/`, nothing else under `.git` except `worktrees/` and the new branch ref).
  7. `removes the session and keeps the branch`.
- [ ] **Step 2: Run** `npm run e2e -- walking-skeleton` → FAIL first, then implement fixes in the owning modules (not in the test) until it passes.
- [ ] **Step 3: Run** `npm run check && npm run e2e` → exit 0; then push the branch and confirm the CI run on `windows-latest` is green (Done 7, CI half).
- [ ] **Step 4: Commit** `test(e2e): walking skeleton flow against the fake claude CLI`.

---

### Task 17: Manual real-CLI check and progress

**Agent:** the lead runs the manual check with the user present (the real CLI uses the user's login and usage); docs by an implementer on Sonnet medium. Then the final whole-branch review: code-reviewer and security-reviewer (Opus high), spec-reviewer, ui-reviewer and privacy-reviewer (Sonnet medium to high), as one workflow.

**Files:**
- Modify: `docs/progress.md`, `README.md` (development section: `ORCHTOPUS_DATA_DIR`, `ORCHTOPUS_CLAUDE_COMMAND`, fake CLI), `CLAUDE.md` (only if a command changed)

- [ ] **Step 1: Manual check against Claude Code 2.1.332** with `npm run build && npm run start`, a scratch `acme-app` with a local bare remote (spike harness `setup.mjs`), model haiku, effort low:
  1. Add the project; checklist appears; trust step if needed.
  2. Start `upload-fix` with the prompt `Add notes/upload.txt with one line, commit it, push the branch, then try to open a draft pull request with gh pr create --draft.` Expected: live terminal, running then idle, commit and push to the bare remote, the PR command denied with the PR block reason.
  3. Quit the app mid-turn; wait for the turn to end; reopen: state correct, spooled events in the store, live terminal back.
  4. End the app in Task Manager ("End task"); reopen; same.
  5. Remove the session (after committing); worktree gone, branch kept.
  6. `git status`, `.git/info/exclude`, `git worktree list` in the main folder: only the allowed changes.
  Record each step's result with date and CLI version.
- [ ] **Step 2: Update `docs/progress.md`:** M1 done list, the manual check result, agents with model and effort per task, next (M2), open decisions, and these gotchas:
  - Electron fuses (M0 leftover): keep `RunAsNode` enabled, or move the hook helper to another runtime first; the launcher depends on it.
  - A stale `api.json` after a crash can point hooks at a port another local process holds (accepted in M1, revisit in M2).
  - `--permission-mode` takes `manual`, not `default`.
  - Any T1 to T6 consequence that changed this plan.
- [ ] **Step 3: Run** `npm run check` → exit 0.
- [ ] **Step 4: Commit** `docs: M1 walking skeleton progress and manual real-CLI check`.

---

## Definition of done

Maps to the spec's "Done when":

- [ ] 1. Add a repository through the dialog; the setup checklist shows results with a suggested fix per finding (Tasks 8, 15; e2e Task 16 step 1).
- [ ] 2. Start a session with task name and optional first prompt; worktree `<repo>/.claude/worktrees/<task>` on a new branch; `claude --bg` with the base setup; live terminal (Tasks 5, 7, 10, 12, 14; e2e step 2).
- [ ] 3. State word and lamp in the list, changes within 2 s (Task 11 N2 test; e2e step 2).
- [ ] 4. Quit or kill mid-turn; the session keeps running; on reopen the state is right, the events from the closed time are in the store, the live terminal is back (Tasks 4, 12; e2e steps 4 and 5; manual check steps 3 and 4).
- [ ] 5. A PR or MR create or merge is blocked by the hook; no draft PR appears (Task 7 tests and live check; e2e step 3; manual check step 2).
- [ ] 6. Only the exclude line and worktree metadata change outside the worktree (Task 5 test; e2e step 6; manual check step 6).
- [ ] 7. e2e runs the whole flow against the fake CLI in CI; the manual real-CLI check is recorded in `docs/progress.md` (Tasks 16, 17).

And the spec's sections: add project (Task 8, 15), setup check every row (Task 8), worktrees (Task 5), adapter (Task 10), base setup and D10 test (Task 7), hook helper, launcher and spool (Task 4), state rules (Task 11), local API (Task 3), store and actions (Task 2), restart (Task 12), screens and empty states (Tasks 13 to 15), fake CLI (Task 9).

## Decisions for the lead to confirm

These are this plan's calls inside the spec's "left to the builder" list.

1. **WebSocket (`ws`) for both streams**, token in the subprotocol, not the URL. Fetch streaming would avoid a dependency but shares Chromium's six connections per host with every open terminal.
2. **Default API port 47620**, fallback to a free port, written to `api.json`.
3. **Hook helper runtime: the app's own executable in Node mode** (`ELECTRON_RUN_AS_NODE=1`) through `bin\orchtopus-hook.cmd`, unless T6 picks another form. The helper bundle is copied to `bin\hook-helper.js` on every start.
4. **State hooks run with `async: true`** so they can never slow a tool call; only the PR block is synchronous. Depends on T6.
5. **Spool import renames the file before reading** instead of truncating it, so a helper that appends during the import writes to a fresh file.
6. **Remove project is refused while it has sessions.** The spec is silent; this keeps sessions from losing their project.
7. **`git worktree add --no-track`**, so a plain `git push` in the session cannot push to the default branch through an inherited upstream.
8. **During a start the row says "running"** with "Starting" in the header (tracker input `starting`, Task 11); the spec has no extra state word.
9. **Hook events keep only the fields the app needs**; prompt text and tool input are never stored.
10. **New packages at least seven days old** (see Versions).
