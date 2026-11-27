# M1: walking skeleton

Date: 2026-11-27
Status: approved by the user on 2026-11-27
Parent: `docs/specs/2026-11-26-orchtopus-product-design.md` (section 7, row M1), refined by `docs/specs/2026-11-27-claude-code-best-practices-addendum.md` (D1 to D3, D9 to D11) and the findings in `docs/spikes/2026-11-27-m1-claude-code-internals.md`. Where this spec and those documents differ, this spec wins for M1.

## Intent

M1 is the first version of Orchtopus that does the real thing end to end, in its simplest form: add a project, start a real Claude Code session in its own worktree, watch it work, close the app, open it again, and find everything as it was.

Every later milestone builds on the parts M1 creates: the `AgentAdapter`, the local API, the state store with its event log, the hook helper, and the session list. M1 makes them real and small, not complete.

## Done when

1. The user adds a Git repository (for example a demo `acme-app`) through a dialog. The setup check shows its results as a checklist with a suggested fix per finding.
2. The user starts a session with a task name and an optional first prompt. Orchtopus creates a worktree in `<repo>/.claude/worktrees/<task>` on a new branch, starts `claude --bg` there with the base setup, and shows the live terminal.
3. The session list shows the session's state word and lamp. A change in the session shows in the list within 2 seconds (N2).
4. The user quits the app in the middle of a turn, or kills it in the Task Manager. The session keeps running. The user opens the app again: the list shows the right state, the events that arrived while the app was closed are in the store, and opening the session shows the live terminal again.
5. A session that tries to create or merge a pull request or merge request is blocked by a hook, and no draft PR appears on the remote.
6. Outside the worktree folder, Orchtopus has changed nothing in the repository except one line in `.git/info/exclude` and the worktree metadata that `git worktree add` writes into `.git/`.
7. The end-to-end test runs the whole flow against a fake `claude` CLI in CI. The same flow is checked once by hand against the real CLI, and the result is recorded in `docs/progress.md`.

## Goals

- Add a project (simple version, F71 stage one) with the read-only setup check.
- Create worktrees and start, show, stop and remove sessions through the `AgentAdapter`.
- The base setup of every session from outside the repository (D3), including a minimal workflow instruction and the PR block.
- A state model that combines `claude agents --json`, hook events and status line input, and that survives restarts.
- Local API on 127.0.0.1 with a per-installation token; the renderer is a client of that API like any later client.
- SQLite state store with an append-only event log; idempotent actions.
- Hook helper with a spool file, so no hook event is lost while the app is closed.
- The first screens in the Lagoon design: title bar, session list, session header, terminal, status bar, the add-project and new-session dialogs.

## Non-goals

These come later, as the parent spec plans:

- Decision cards, inbox, "Then" strip, Windows notifications, stalled detection, permission cards through the `PermissionRequest` hook, dangerous commands and parking (M2).
- Workflow phases, gates, the `Stop` hook check (D4), goal runs (D5), spec and plan views, info column, side chat and advisor, the full set of three hard blocks (M3).
- Review, PR drafts and release, provider integration beyond detecting the remote (M4).
- Crash recovery view, context management, usage view, board, project terminal, external sessions (M5).
- Settings screen, themes other than Lagoon, keymap, command palette, octopus (M6).
- Session types other than "feature" (M8). The data model has a `type` field from the start.
- The setup check items that need a model to read files (M8).
- A separate Orchtopus service process (see "Approaches").

## Anti-goals

- A session creates or merges a PR or MR (E24). M1 already blocks it, because background sessions open a draft PR on their own by default.
- Orchtopus writes into the user's repository beyond what "Done when" item 6 allows, or into the user's own Claude Code settings (`~/.claude/settings.json`, `~/.claude.json`) without a visible user action.
- A hook of Orchtopus blocks or slows the user's work when the app is closed or broken. Only the PR block may block, and it is a local command hook.
- Orchtopus sends `/model` or any other slash command that writes user settings into a session.
- State shown by colour only, without a word.
- The state store or spool lands in a synced folder.

## Constraints

- Claude Code 2.1.332 is installed; minimum supported is 2.1.302 (D2). Before the plan builds on a flag, setting key or hook field, the lead checks the current documentation. The items under "Checks at the start of the plan" are open until tested.
- Internal formats of Claude Code (transcript JSONL, `~/.claude/jobs/`) are not parsed.
- CI has no Claude Code login. Everything that CI tests runs against a fake `claude` CLI.
- Public repository, English only, generic demo names only (`acme-app`, `upload-fix`, ...).
- Before the first M1 code, the small M0 leftovers from `docs/progress.md` go into their own PR: dev reload check, redirect handling, CI concurrency, and the `app://` protocol instead of `file://` (the renderer starts to grow in M1).

## Approaches

Where the parts of Orchtopus run, given that Claude Code's own supervisor keeps the sessions alive when the app is closed:

| Approach | Trade-off | Decision |
|---|---|---|
| A. Everything in the Electron main process: API, store, PTYs | One process, simplest. Hook events that arrive while the app is closed are lost; on start the app knows only what `claude agents --json` shows now. | Rejected |
| B. A separate Orchtopus service that starts with Windows and owns API, store and PTYs; the window is a client | No event is lost; a later pad or watch could connect without the window. A second process with autostart, updates and crash handling; M1 grows by about a third; the benefit arrives only with the pad and watch, which are out of scope. | Rejected for now |
| **C. Like A, plus a spool:** a hook that cannot reach the app writes its event to a file in the data folder; the app imports the file on start | No event is lost, one process. M2 needs the same mechanism for parked commands anyway. While the app is closed nobody sees events live. | **Chosen by the user** |

Moving from C to B later does not change the UI, because the renderer already talks only to the local API.

## Decisions

### 1. Add a project

1. The user picks a folder. It must be the top level of a Git repository (`git rev-parse --show-toplevel`). A worktree or a bare repository is refused with a clear message.
2. Orchtopus detects and shows:
   - default branch (from `origin/HEAD`, else the current branch) and remotes; the provider (GitHub or GitLab) is recognised from the remote URL and only shown in M1;
   - check commands: test, lint and type check, from `package.json` scripts and, where obvious, other common manifests; each can be edited or cleared;
   - the list of git-ignored files to copy into new worktrees (D11), suggested from existing `.env*` files at the top level; editable;
   - the branch prefix, default `orch/`.
3. The setup check runs (section 2).
4. If Claude Code does not trust the folder yet (`claude --bg` needs workspace trust), the dialog offers "Trust in Claude Code". It opens plain `claude` in the folder in a terminal inside the dialog; Claude Code's own trust prompt comes first, and the user answers it there. After the answer Orchtopus closes that session (`/exit`). Orchtopus never writes the trust entry itself.
   - Detecting trust: there is no documented command for it. Orchtopus reads `~/.claude.json` read-only, best effort, and only for this one value. If the file or the value cannot be read, the state is "unknown" and the trust step is offered. Nothing else in that file is used, and the app never writes it.
5. The user confirms. The project config is written to the data folder (`projects/<project-id>/project.json`, with a schema version). Nothing is written into the repository.

### 2. Setup check (read only)

Runs when a project is added and on request. Every result has a status (ok, hint, problem) and, where possible, a suggested fix the user can copy (for example a command). Orchtopus applies nothing.

| Item | Status when it fails | Source |
|---|---|---|
| Claude Code version is at least 2.1.302 | problem (sessions cannot start) | D2 |
| Workspace trust for the folder | problem until trusted (see section 1) | spike |
| At least one check command exists (test, lint or type check) | hint | D4, best practices "Give Claude a check to run" |
| `CLAUDE.md` (project and user) has fewer than 200 lines | hint | docs `memory`: target under 200 lines |
| `CLAUDE.md` has no emphasis words in capitals (`IMPORTANT`, `YOU MUST`, ...) | hint | docs `best-practices` |
| Secrets are covered by deny rules in the user's or the project's own settings (`.env`, `.env.*`, `secrets/**`) | hint; Orchtopus sessions get these rules anyway | D1, docs `best-practices` |
| superpowers is installed | hint with the install command | D9 |
| Auto memory is on (`autoMemoryEnabled` not `false`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY` not set) | hint; the learnings loop (D8) reads it later | docs `memory` |
| `permissions.defaultMode` in the user settings is not `bypassPermissions` | problem shown as a warning; Orchtopus starts its own sessions with an explicit mode anyway | D1. Note: `auto` and `bypassPermissions` take effect only from user settings, not from project settings |
| Project skills (`SKILL.md`) have fewer than 500 lines | hint | docs `skills` |
| Personal settings are not in the committed `.claude/settings.json` (for example a `defaultMode` there, which Claude Code ignores) | hint | docs `settings` |
| A pointer that `/doctor prompt-audit` exists | always shown, as information | docs `memory` |

The line limits are targets from the documentation, not rules: they are hints and never block. The exact setting keys are checked against the documentation when the plan is written. The check that `CLAUDE.md` only holds what the code does not show needs a model and stays in M8.

In M1 the results are shown in the add-project dialog and on request from the project's menu in the session list. From M2 they also go to the inbox.

### 3. Worktrees

- Orchtopus creates the worktree itself: `git worktree add -b <prefix><task> <repo>/.claude/worktrees/<task> <base>`.
- Base: after a `git fetch` of the default remote, `origin/<default branch>`; without a remote, the local default branch. If the fetch fails, the user is told and can start from the local branch.
- Before the first worktree of a project, Orchtopus makes sure that `.claude/worktrees/` cannot be pushed:
  - if any file under `.claude/worktrees/` is tracked (`git ls-files`), the start is refused with a message;
  - if the path is not ignored (`git check-ignore`), Orchtopus adds `/.claude/worktrees/` to `.git/info/exclude`. That file is local and never pushed.
- The files on the project's copy list are copied from the main folder into the new worktree after creation. A missing file is a hint, not an error.
- The task name becomes the folder and branch name. It is checked: lower case, digits and dashes; unique among the project's worktrees and branches.
- Claude Code's own background isolation is switched off in the generated settings (`worktree.bgIsolation: "none"`, key to be confirmed, see "Checks at the start of the plan"), so the session stays in the worktree Orchtopus made.

### 4. Sessions and the adapter

The UI and the API know only the `AgentAdapter` interface. M1 has one implementation, the background-session adapter from the spike.

- **Start:** in the worktree as working directory, `claude --bg` with:
  - `--settings <file>` generated per session in the data folder (section 5);
  - `--append-system-prompt-file <file>` with the workflow instruction (section 5);
  - `--agents` and `--plugin-dir` only when Orchtopus has something to pass (nothing in M1; the plumbing exists);
  - `--model` and `--effort` only when the start dialog sets them; otherwise Claude Code's defaults apply;
  - `--permission-mode auto`, or `manual` if the user chose manual mode in the start dialog (D1; hook payloads then report `permission_mode: "default"`); never `bypassPermissions`;
  - model, effort and mode are chosen per session in M1. The start dialog remembers the last values per project in `project.json`; per-project and per-role defaults with their own UI come with the settings screen (M6) and models per role (M5);
  - `--name <task>`;
  - the first prompt, if the user gave one.
- **Session id:** `--session-id` is ignored with `--bg`. The adapter reads `sessionId` from `claude agents --json --all --cwd <worktree>` after the start and stores it.
- **Show:** one `claude attach <id>` PTY per session, owned by the app; a second attach would take the session over. The PTY is opened when the user opens the session, not for every session at app start, because each attach after a pause makes Claude write a recap, which costs usage. Once open, it stays attached until the app quits. Keys are not sent before the TUI has rendered.
- **Input:** only through the attached PTY. `claude --resume <id> "<msg>"` is refused for a running background session.
- **Stopped sessions:** a session that Claude Code stopped (after about an hour unattached and idle, after a reboot, or by `claude stop`) shows "stopped". Opening it resumes it with `claude --bg --resume <uuid>` without flags, which restores its saved options (spike R1), then attaches.
- **Stop:** `claude stop <id>` from the session header.
- **Remove:** stops the session if needed, then `git worktree remove`. If the worktree has uncommitted changes or untracked files, removal is refused with a message; the branch is never deleted by Orchtopus. Asks for confirmation.
- **Explorer and VS Code** buttons open the worktree folder. VS Code is shown only if `code` is found.
- No limit on the number of sessions.

### 5. Base setup and hooks

All files below live in the Orchtopus data folder, are generated from versioned building blocks shipped with the app, and are never written into the repository.

- **Generated settings file per session:**
  - hooks for state events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd` and `Notification`, all running the hook helper without `onFailure`, so a broken helper never blocks the session;
  - the PR block: a `PreToolUse` hook on the shell tools with `onFailure: "block"`, which denies `gh pr create`, `gh pr merge`, `glab mr create`, `glab mr merge` with a reason Claude can read. It decides locally and does not need the app. The full set of hard blocks (force push, push to protected branches, API calls, push options, MCP tools) comes in M3;
  - the status line command (hook helper in status line mode);
  - deny rules for secrets: `Read(./.env)`, `Read(./.env.*)`, `Read(./secrets/**)` and the user's SSH key folder (D1);
  - `autoMode.environment` with `"$defaults"` plus one line naming the project's remotes, with any credentials stripped from the URLs (D1); registries and domains confirmed by the user come later;
  - the worktree isolation switch from section 3.
- **Workflow instruction (M1 version):** a short text that tells the session it works in a worktree managed by Orchtopus, that it may commit and push its own branch, and that it must not open pull requests or merge requests because Orchtopus does that after the user's release. It follows D10: short, no emphasis words in capitals. A unit test checks D10 for every shipped prompt and skill from this first file on.
- **Hook helper:** one small local command used by every Orchtopus hook and by the status line.
  - It reads the API port and the token from files in the data folder at each call.
  - It sends the event to the local API with a short timeout. If the API is not reachable or answers with an error, it appends the event to the spool file in the data folder.
  - Every event carries an id made by the helper, the session id, the hook name, a time stamp and the payload fields the app needs.
  - State hooks always exit 0 quickly. The status line mode prints a short line for the attached terminal.
  - It must not depend on a Node.js installation of the user. How it runs (for example the Orchtopus executable in Node mode, or a small bundled script) is left to the builder, as long as one call stays fast enough for every tool call (target: well under 300 ms).
- **Stable paths.** A session keeps the paths from its start for its whole life, also across resume (spike R1). Every hook and the status line therefore call a small launcher at a fixed path in the data folder (for example `bin\`), and the settings files keep fixed paths too. The app refreshes the launcher, the helper and the settings contents on every start, so an update or a move of the app does not break running sessions. If the launcher cannot find the helper (for example after Orchtopus was uninstalled), it exits 0 without a decision: Orchtopus never blocks a session's work when Orchtopus itself is gone. The PR block is then off, which the anti-goals accept; from M4 the PRs view reports PRs that Orchtopus did not create.

### 6. Session state

Sources: `claude agents --json --all` polled about every second, hook events, status line input, and the adapter's own actions.

| State word | Lamp | Rule |
|---|---|---|
| running | blue | `working` / `busy`, or any hook or status line event in the last few seconds |
| needs you | amber | `blocked` / `waiting` (permission prompt or dialog in the terminal), or `blocked` / `idle` (the turn ended with a question or an error) |
| idle | neutral | `done` / `idle`; also `working` / `idle` when a `Stop` event came and no further event followed for a few seconds (the stale case from the spike) |
| stopped | neutral, hollow | `stopped`; `done` with no `status` (seen after `claude stop`); or the session is missing from `agents --json` while the store still has it |
| failed | red | `failed`, or the start failed; the reason is shown in the session header. After a reboot the docs say a session shows `failed` for up to 48 hours: opening such a session resumes it like a stopped one |

- `working` / `idle` right after a process start is treated as running until the rule above applies.
- `needs you` from `blocked` / `idle` is not always a real question (spike Q1). M1 shows it anyway, because an error also needs the user; M2 refines it.
- The exact time windows are left to the builder; changes must show within 2 seconds.
- The word "done" is kept for a finished task (PR merged), which comes with M4. In M1 a finished turn is "idle".
- The context fill and the limits from the status line are stored per session and shown as "unknown" until the first value of a process. M1 shows the context fill in the session header; the usage view is M5.

### 7. Local API

- HTTP on 127.0.0.1 only. A fixed default port with fallback to a free port; the chosen port is written to a file in the data folder for the hook helper.
- One token per installation, created on first start, stored in the data folder in a file readable only by the user. Every request needs it, including the event stream and the terminal stream. An API route can create a new token; the button for it comes with the settings screen (M6).
- The API checks the `Host` header and rejects requests from browser origins other than the app's own.
- The renderer is a client of this API: user actions, the event stream and the terminal stream (WebSocket or similar) all go through it. The preload passes the renderer only what it needs to connect.
- State changes are events that clients subscribe to.
- Routes, payloads and the event stream format are left to the builder. They are documented in the code and covered by tests.

### 8. State store and spool

- SQLite (better-sqlite3) at `%APPDATA%\Orchtopus\state.db`, always on the local machine, never in a synced folder.
- An append-only event log is the source of truth; tables for projects, sessions and their current state are projections of it.
- Every action that changes something outside the app (create a worktree, start, stop, remove) is logged before it runs, with an id, and can be repeated without doing the work twice. If the app dies in the middle of a start, the next start continues or cleans up from the log (for example a worktree exists but no session id is known).
- Spool: on start, and when the API comes up, the app imports the spool file in order, skips events whose id it already has, and then truncates the file. A damaged line is kept in a separate file and reported, not dropped silently.
- Data folder: default `%APPDATA%\Orchtopus\`. The code reads the location from one place so that it can become selectable later; M1 has no UI to change it.

### 9. Restart

On every start, before the UI shows sessions:

1. Import the spool.
2. Read `claude agents --json --all` for every project folder and match entries to stored sessions by session id.
3. Apply the state rules; sessions not found are "stopped".
4. Continue or clean up unfinished actions from the log.

Closing the window quits the app. Sessions keep running under Claude Code's supervisor. A tray icon is not part of M1.

### 10. Screens

Built with the Lagoon tokens from `DESIGN.md`, components from the chosen libraries (base-ui, react-resizable-panels, xterm.js for the terminal). The unslop checklist runs on every screen; the `ui-reviewer` checks tokens, contrast and signal colours.

```
┌ Orchtopus · acme-app ▾ ──────────────────────────────────────┐
│ Sessions            │ upload-fix · ● running · orch/upload-fix │
│ acme-app        ⋯   │ ctx 18 %   [Explorer] [VS Code] [Stop] ⋯ │
│  ● upload-fix running│──────────────────────────────────────────│
│  ● report-export     │  Terminal (real claude)                  │
│      needs you       │                                          │
│  ○ i18n-de  idle     │                                          │
│ [+ Session]          │                                          │
│ [+ Project]          │                                          │
├──────────────────────────────────────────────────────────────┤
│ 1 running · 1 needs you · API connected                       │
└──────────────────────────────────────────────────────────────┘
```

- Title bar, session list grouped by project (lamp and word per session), session header, terminal, status bar with state counts and connection.
- Add-project dialog with the setup checklist and the trust step. New-session dialog with task, branch (derived, editable), base, optional first prompt, model, effort, mode.
- Empty states: no project yet (one action: add a project); project without sessions (one action: start a session).
- The project menu (`⋯`) offers "Run setup check" and "Remove from Orchtopus" (removes the config only, never files).
- Not in M1: decision card, "Then" strip, info column, inbox, octopus.

## Checks at the start of the plan

Short tests against the real CLI, run before code depends on them. Each has a fallback.

| # | Question | Fallback |
|---|---|---|
| T1 | Does `worktree.bgIsolation: "none"` (or the current key) keep a `--bg` session in the given folder for edits inside the repository, and does the session then skip its automatic commit, push and draft PR when told so in the workflow instruction? | If it stays in the folder but still opens a PR: rely on the PR block hook and check the remote for PRs on the branch after each turn, with a visible warning. If no setting keeps the session in Orchtopus' worktree, the plan stops after T1 and the lead brings the options to the user. T1 is the first task of the plan; tasks that depend on section 3 come after it. |
| T2 | Is workspace trust for the repository inherited by `.claude/worktrees/<task>`? | Run the trust step per new worktree, in the new-session dialog. |
| T3 | Does `claude --bg` start without a first prompt and wait? | Require a first prompt in the dialog. |
| T4 | Does quitting or killing the Electron app (and its attach PTYs) leave the background sessions running? | Start `claude --bg` and `claude attach` detached from the app's process tree. |
| T5 | Does a deny rule for the SSH key folder (`Read(~/.ssh/**)` or the documented form) block reads? | Use the form the documentation gives for absolute paths. |
| T6 | Hook helper start time on Windows with the chosen runtime. | Another runtime for the helper. |

## Testing

- Unit tests (Vitest) for the state rules, the spool import, idempotent actions, settings generation, task name checks, the setup check items, and the D10 check on shipped prompts.
- A fake `claude` CLI for tests and CI: it answers `--version`, `--bg`, `agents --json`, `attach`, `stop` and `--resume` from scripted scenarios and calls the hook helper like the real CLI. The adapter finds `claude` through a configurable path so tests can point it at the fake.
- End-to-end (Playwright): add a demo project, start a session, see output and state, quit and restart the app, see state and output again, remove the session.
- Manual check against the real CLI once per release of M1, recorded in `docs/progress.md`.

## Calls made by the lead

The user decided the worktree location (`.claude/worktrees/`), the approach (C), the add-project and start flows, the setup check list and the screen scope. These points are the lead's calls and can be corrected in the review of this spec:

1. One API token per installation, renewable through an API route; the button comes with the settings screen (M6).
2. The PR block (create and merge of PRs and MRs) already in M1, because background sessions open draft PRs on their own.
3. "Remove session" in M1: stops the session and removes a clean worktree; never deletes the branch.
4. A finished turn is "idle"; the word "done" is kept for a finished task (M4).
5. Model, effort and mode per session in M1; the dialog remembers the last values per project.
6. Trust is detected by reading one value of `~/.claude.json` read-only; if that fails, the state is "unknown" and the trust step is offered.
7. Hooks call a launcher at a fixed path; if Orchtopus is gone, the launcher allows, so sessions never get stuck.
8. If T1 shows that sessions cannot be kept in Orchtopus' worktree, the plan stops and the user decides.

Smaller builder calls, recorded so the plan follows them:

- `agents --json` is polled once without `--cwd` and filtered in the app; filtering by `--cwd` is covered by a test.
- An interrupted start takes over a session found by its working directory and never deletes a worktree that has changes.

## Left to the builder

- Module layout, IPC between main and preload, database schema, event names, API routes and stream formats.
- The exact `AgentAdapter` method signatures.
- Polling interval and the time windows of the state rules, within N2.
- The runtime of the hook helper (section 5 constraint applies).
- How check commands are detected for non-JavaScript projects.

## Open points for later milestones

- The terminal prompt is live while a `PermissionRequest` hook waits; the M2 card must close when the terminal answers first.
- Classifier inbox, "auto mode paused" and `autoMode.environment` effect: M2 builds them so they degrade to nothing if the hook never fires.
- Parked dangerous commands keep the pause-session fallback as an option (M2).
- Side chat: recheck that `--strict-mcp-config` empties the tool list (M3).
