# Progress

Last update: 2026-11-28 (M1 walking skeleton built on branch `feat/m1-walking-skeleton`, PR open, Task 17 open; lead: Opus 5.5 high)

## Done

- Handover pack read in full (concept, implementation guide, templates, mockups, prototype).
- Repository created locally with `main`. Handover pack copied to `docs/handover/`, renamed from the working title to Orchtopus, concept translated to English (`docs/handover/docs/concept.md`).
- `CLAUDE.md`, agents in `.claude/agents/`, `.gitignore`, `LICENSE` (MIT), `README.md`.
- Skills: unslop installed at project scope (`.claude/settings.json`), `pick-ui-library` installed to `.claude/skills/`. superpowers and i-have-adhd already exist at user scope.
- Claude Code internals checked against the current docs (see below).

### M0 tooling (2026-11-27, merged through the pull request of branch `feat/m0-tooling`)

- Scripts: `dev`, `build`, `start`, `check`, `lint`, `format`, `typecheck`, `test`, `e2e`, `smoke:native`, `package`, `audit`. See `CLAUDE.md`, section "Commands".
- CI on `windows-latest` (`npm ci`, `check`, `smoke:native`, `e2e`, `audit`) plus a gitleaks scan.
- Security defaults for the Electron window, covered by unit tests and by 10 e2e tests. The e2e suite also passed against the packaged app in `release/win-unpacked/`.
- Design tokens are built into CSS by a Vite plugin. 114 unit tests.
- Unsigned directory build with `npm run package`.
- Final review: code, security, spec, UI and privacy reviewers on the whole branch, one fix wave (`ee061de` to `fcdd9ea`), re-review approved with no blocking finding.
- The repository has a local git identity with the GitHub noreply address, so commits do not carry a personal e-mail.
- Left for later PRs (none blocks M0):
  - Electron fuses, before any release milestone.
  - `npm` `allowScripts` policy. npm 11 skips the install scripts of node-pty and better-sqlite3; the prebuilds load and `smoke:native` guards it in CI.
  - Packaged build e2e in CI.
  - Refuse `url(`, `image-set(` and `!important` in token values, before themes can be loaded from user folders.
  - `Menu.setApplicationMenu(null)`, bundled Figtree and JetBrains Mono font files, a check for named CSS colours in renderer sources.
  - Document `ORCHTOPUS_BACKGROUND_WINDOW` in the README.

Agents for M0: implementers 10x Opus (medium) plus fix rounds, task reviews 10x Sonnet (medium), final reviews code and security Opus (high), spec, UI and privacy Sonnet, fix wave Opus (medium), re-review Opus (high), docs Sonnet. Lead: Fable. Tasks 7b to 10 and the final review ran as workflows.

### M1 walking skeleton (2026-11-28, branch `feat/m1-walking-skeleton`, PR open)

Spec: `docs/specs/2026-11-27-m1-walking-skeleton-design.md`. Plan: `docs/plans/2026-11-27-m1-walking-skeleton.md`.

- Tasks 2 to 16 done: event store and idempotent actions, local API (127.0.0.1, token, event and terminal streams), hook helper with launcher and spool, git worktrees, setup check, fake CLI, base setup with the PR block hook, background-session adapter (`claude --bg`, attach PTY), state tracker and rules, restart recovery, session list, session view with live terminal, add-project and new-session dialogs, trust step, e2e of the whole flow against the fake CLI.
- Fix wave: about 485 review findings triaged to about 310 unique. The 14 must-fix items and the should-fix lanes (A1, A2, B, C, D, E, F, G1, G2, R1, R2) are merged into the branch. The 42 deferred items are in "M1 leftovers".
- Final whole-branch review (code, security, spec, UI, privacy): no open blocking finding after the last fixes. Its 47 non-blocking findings are in "M1 leftovers".
- After the review: `NoDefaultCurrentDirectoryInExePath=1` for the main process, kept out of Claude Code processes (`claudeEnv()`). F6 leaves a terminal; the trust step and the session header show the hint "F6 leaves the terminal".
- Tests on 2026-11-28: 912 unit tests in 69 files (`npm run check` exit 0), 55 e2e tests (`npm run e2e`, all passed).
- Open: Task 17 (manual real-CLI check with the user, about 20 minutes), then merge the M1 PR.

Agents for M1:

| Agent | Model and effort |
|---|---|
| implementer | Opus medium |
| code-reviewer and security-reviewer | Opus high |
| spec-reviewer | Sonnet medium |
| ui-reviewer | Sonnet high |
| privacy-reviewer | Sonnet medium |
| merge agents | Sonnet medium |
| triage | Opus high |
| research and verification | Opus high |
| docs writer | Sonnet medium |

Lead: Opus 5.5 high. Workflows ran the parallel lanes. One usage-limit stop was resumed after the reset.

### M1 spike (2026-11-27)

- Findings: `docs/spikes/2026-11-27-m1-claude-code-internals.md`. Harness to rerun the experiments: `spikes/m1-claude-code/` (see its README). Tested on Claude Code 2.1.332, Windows 11.
- Result: M1 uses the background-session adapter (`claude --bg`, one app-owned `claude attach` PTY per session). The child-process fallback is not needed. D1 of the addendum (auto mode by default) stands provisionally: addendum item 1 (classifier) is open, not passed.
- After a review of the verdicts against the logs, the findings were reworded to what was observed, and three reruns closed gaps: R1 (system prompt flags and plugin survive a resume without flags and a respawn), R2 (`onFailure: "block"` blocks a crashing hook in auto mode), R3 (a deny rule wins over a hook `allow` for Bash).
- Confirmed: `--bg` survives the death of its parent (one run, plain Node parent, not Electron) and reattaches with live output; the base setup flags work with `--bg` and persist over attach, resume without flags and respawn (`--agents` and `--name` after a resume without flags are only shown by the resume note); status line runs unattached; `PermissionRequest` http hook (allow, deny, timeout, receiver down); `PreToolUse` hold, park and exact-match one-time release (mechanics); `onFailure: "block"` on crash (manual and auto mode) and timeout (manual mode); skill name in `tool_input.skill`; `Stop` hook with `stop_hook_active`; `SessionStart` and `PreCompact` context; deny rules and hook denies in auto mode; side chat fork idle and mid-turn.
- Not confirmed: a classifier block, the `PermissionDenied` payload and the effect of `autoMode.environment` (no classifier decision provoked), classifier cost (not measurable), that models never work around a parked command (3 single runs, no Opus), `onFailure: "block"` with `exit 1` and with a timeout in auto mode, a deny rule for the SSH key folder, the `--strict-mcp-config` effect on the side chat (not in the logs), maximum hook wait beyond 600 s, automatic compaction, `/goal` through the PTY, PTY input mid-turn, the background-session git behaviour for edits inside the repository (worktree, automatic commit, push and draft PR).

Agents for the spike: 1x Opus (high) for harness, experiments and findings; 1x Opus for the review fixes and reruns R1 to R3. Lead: Fable.

### M0 versions

Exact pins in `package.json`. Source: the "Versions" table in `docs/plans/2026-11-27-m0-tooling.md`.

| Package | Version | Evidence |
|---|---|---|
| electron | 45.5.0 | Bundles Node 24.22.3, Chromium 156, ABI 150; the app and e2e run on it |
| electron-vite | 6.0.0 | Peer `vite ^6 \|\| ^7 \|\| ^8` |
| vite | 8.4.0 | Inside the electron-vite and vitest peer ranges |
| react, react-dom | 19.3.1 | react-dom peer `react ^19.3.1` |
| @types/react, @types/react-dom | 19.3.3, 19.3.0 | @types/react-dom peer `@types/react ^19.3.0` |
| typescript | 6.0.3 | typescript-eslint 8.74.0 has peer `typescript <6.1.0`; npm `latest` is 7.0.2 |
| eslint, @eslint/js | 10.15.0, 10.0.1 | npm `latest`, matching pair |
| typescript-eslint | 8.74.0 | Peer `eslint ^10` |
| eslint-plugin-react-hooks | 7.1.1 | Peer includes `eslint ^10` |
| eslint-config-prettier | 10.1.9 | Flat entry point `eslint-config-prettier/flat` |
| globals | 17.14.0 | npm `latest` |
| prettier | 3.10.1 | `lint` runs `prettier --check .` |
| vitest | 5.1.2 | 114 unit tests pass |
| @playwright/test | 1.65.1 | `_electron` is experimental; 10 e2e tests pass |
| node-pty | 1.1.0 | `smoke:native` PASS; ships win32-x64 prebuilds |
| better-sqlite3 | 13.2.0 | `smoke:native` PASS, sqlite 3.54.1; Node-API prebuilds inside the package |
| electron-builder | 26.18.0 | `npm run package` builds `release/win-unpacked/` |
| @types/node | 24.19.4 | Newest 24.x |

Not installed: `@electron/rebuild` 4.2.1 (not needed, fallback only) and `@vitejs/plugin-react` 6.3.0 (its Fast Refresh preamble is an inline script that the CSP blocks).

### SQLite binding

better-sqlite3 13.2.0: Node-API prebuilds for win32-x64, no compiler and no Electron rebuild needed, loads in Electron 45.5.0 (Node 24.22.3, modules 150) (smoke:native PASS, sqlite 3.54.1). `node:sqlite` in Electron 45: available, sqlite 3.54.1 (INFO line from smoke:native). node-pty 1.1.0 also PASS.

Agents used in session 1: mockup and prototype analysis 2× Sonnet; concept translation 4× Sonnet (medium); Claude Code research 2× claude-code-guide; install command check 1× web-fetch; privacy review 1× Sonnet (high).

## Next

1. **Task 17 with the user** (about 20 minutes): the manual check against the real CLI in plan `docs/plans/2026-11-27-m1-walking-skeleton.md`, Task 17. Record each step with date and CLI version here. Add the README development section (`ORCHTOPUS_DATA_DIR`, `ORCHTOPUS_CLAUDE_COMMAND`, fake CLI). Check the Task 17 items under "Gotchas from M1".
2. **Merge the M1 PR** after Task 17 and a green windows-latest CI run.
3. **M2 lead session** starts with brainstorming. Inputs: the spikes on cross-session messaging (PR 16, `docs/spikes/2026-11-28-cross-session-messaging.md`) and mods versus hooks (PR 18), the review-page design (merged PR 17, `docs/specs/2026-11-28-review-page-template-design.md`), and "M1 leftovers".

Earlier notes, kept for reference:

The M0 leftovers PR (branch `fix/m0-leftovers`) does the dev reload, redirect handling, parsed `loadURL` value, CI concurrency and the `app://` protocol. The built renderer loads from `APP_ORIGIN` (`app://orchtopus`, `src/shared/app-origin.ts`); M1 Tasks 3 and 12 import it. `location.reload()` fires `will-navigate` in Electron 45, so a reload by the page works with the dev server only; `e2e/dev-reload.spec.ts` checks it against a local http server that stands in for Vite.

The M1 spec must settle the points under "Open decisions" that the spike raised. Start the next lead session with the folder `orchtopus` as working directory so the project agents in `.claude/agents/` load.

Known gap after M0: CI does not build or start the packaged app (`npm run package`); it is checked locally only. Add a packaged-app check to CI when an installer is introduced.

Backlog ideas live in `docs/backlog.md` (first entry: Logitech MX Master 4 integration).

Step 3 is done: the product design spec is merged (`docs/specs/2026-11-26-orchtopus-product-design.md`).

Step 4 is done: the user chose the direction **Lagoon** (round 2, variant B) with the octopus from variant A and the "Then" strip from variant C. `DESIGN.md` holds direction, tokens, components, motion rules and theme structure. Reference mockup: `docs/design/reference/lagoon.html`, tokens: `docs/design/reference/lagoon.tokens.json`. All explorations stay in `docs/design/explorations/` (open `index.html` and `round-2.html` through a local web server, because the pages embed the mockups in frames).

UI libraries chosen with the user: base-ui, cmdk, Sonner, zustand, shiki, plain CSS with CSS variables, react-resizable-panels; later as needed Virtuoso, dnd kit, recharts, motion.

Agents for step 4: 8x Opus (high) for round 1, 3x Opus (high) for round 2, 1x Opus (high) for the reference mockup and `DESIGN.md`, reviews by Opus (spec) and Sonnet (UI and privacy).

## Decisions by the user (session 1)

- Name: Orchtopus. "Orch"-style naming is welcome where it fits, also for the pixel-art pet.
- Public repo on GitHub under the user's account. Everything in the repo is English.
- The human gate at the end is "release PR", not merge (E24 overrides G10 and F17).
- Nothing in the user's project repositories if avoidable. Storage location should be selectable.
- GitLab is required (available on another machine of the user, not on this one).
- Mockups in the pack are inspiration. More and more varied design explorations are wanted, made with the design skills, realistic for the workflow.
- Since 2026-11-27 the lead merges every PR of this repository itself after a review by a suitable agent with no open blocking findings.
- The octopus is an animated, customisable character with styles and accessories; interactions get a motion pass.
- Messages to the user end with a clear line: what is needed from the user, or that it is for information only.
- 2026-11-27, after the M1 spike: the `.claude` folder inside a project repository may hold what Claude Code or Orchtopus create there (for example the worktrees of background sessions). Orchtopus content such as the wiki stays outside the repository folder. For anything in `.claude`, Orchtopus checks whether it would be pushed (tracked or git-ignored). This is the lead's reading of a short message; confirm the details in the M1 spec.

## Findings: Claude Code internals

Installed: Claude Code 2.1.332 (updated by the user on 2026-11-27; this section was written against 2.1.292). The items marked *test* are answered in `docs/spikes/2026-11-27-m1-claude-code-internals.md`. Where that document and this section differ, the spike document wins. Known corrections: `claude --resume <id> "<message>"` is refused for a running background session (input goes through the attached PTY only); a typed `/skill` is visible to hooks (`UserPromptSubmit`, `UserPromptExpansion`); `--session-id` is ignored with `--bg`; a second `claude attach` takes the session over.

**Session lifecycle (recommended: background sessions)**
- `claude --bg` sessions run under Claude Code's own supervisor and survive a closed terminal or app. `claude attach <id>` in our PTY shows them. `claude agents --json [--all]` lists them with `state` (working, blocked, done, failed, stopped) and `status` (busy, waiting, idle).
- A reboot stops them. A finished or waiting session that stays unattached for about an hour is stopped; the conversation resumes on attach.
- Fallback: child process in our PTY with `--session-id <uuid>`, recovered with `--resume <uuid>`. Running tool calls, background shells and subagents are lost on resume. Flags such as `--settings` must be passed again.
- *Test:* Windows behaviour, `--permission-mode` and `--append-system-prompt` together with `--bg`, whether the status line runs in background sessions, several attached clients.

**Status line**
- JSON fields include `context_window.used_percentage`, `rate_limits.five_hour` and `rate_limits.seven_day` (each `used_percentage`, `resets_at`), `session_id`, `model`, `effort`, `worktree`.
- Rate limits appear only after the first API response. There is no other documented source for context fill and limits.

**Permissions**
- `PermissionRequest` hook of type `http` fits: it fires only when a prompt would appear. Allow or deny in `hookSpecificOutput.decision.behavior`; an empty 200 falls through to the normal terminal prompt.
- Default timeout 600 s. Timeout or connection error is fail-open: the normal prompt appears. That is the wanted fallback.
- "Always allow" can be written through `updatedPermissions` to session, local settings, project settings or user settings.
- *Test:* whether the terminal prompt is visible while the hook waits.

**Workflow enforcement without the bridge mod**
- `PreToolUse` can deny a Bash command with a reason Claude reads (force push, push to main, `gh pr create` while a gate is red).
- `Stop` hook can block stopping with a reason, capped at 8 consecutive continuations.
- `SessionStart` (also after compaction), `UserPromptSubmit` and `PreCompact` can inject context.
- Skill use is visible through `PreToolUse` with matcher `Skill`, but not when the user types `/skill`. *Test:* the field that holds the skill name.

**Keeping project repos clean**
- Hooks and settings through `--settings <file>` outside the repo; instructions through `--append-system-prompt-file`. Both must be passed again on resume.
- This replaces the managed `CLAUDE.md` section (E17, F30) as the default.

**Side chat and advisor**
- `claude -p --resume <id> --fork-session --tools "" --output-format stream-json "<question>"` forks the session, has no tools and leaves the original untouched.
- Fallback: fresh `claude -p` with a condensed context (plan, diff, last messages).
- *Test:* fork while the session is in the middle of a turn.

**Sending input to a session**
- Background sessions accept `claude --resume <id> "<message>"` as the next turn (not for messages that start with `/` or `!`). Otherwise write to the PTY.

## Decisions by the user (2026-11-28)

- Every Claude Code setup, model, effort or harness choice rests on `docs/evidence/claude-code-setup.md`: a current official source or our own measurement, otherwise the documented default or a setting. No unexplained own numbers. Quality first; usage optimisation later.
- Lead: Opus 5.5 `high` by default; Fable 5.2 chosen per phase or task. Haiku only for classification and routing; summaries and mechanical work on Sonnet.
- One lead session per phase (brainstorming, spec and plan; implementation), handoff through this file.
- Plans mark parallel lanes; independent tasks run in parallel (used from M1 Task 3 on). The rule "at most three Opus agents" is withdrawn.
- Agent task board as in Anthropic's multi-agent post: build it in the SQLite event log, behind the user's gates (backlog).
- WSL2 sandbox: a setting per project with a setup assistant, later possibly the default (backlog).

Done in the M1 fix wave (from the evidence register): minimum Claude Code version 2.1.295 with a "not tested" hint below 2.1.332 [EV-H10]; drop the 120-word limit of the workflow-instruction test [EV-H8]; state timing constants in one place with their source, and measure stale-after-Stop and start grace [EV-H9]; remove the no-op `timeout` on async state hooks.

## M1 leftovers

From the fix-wave Defer list and the 47 non-blocking findings of the final review, grouped and deduplicated.

**M2: correctness and security**
- Sessions: project remove ignores a pending `session.start`; the pending-start check compares only the task, not the branch; `stop()` has no skip for a stopped session; a timed-out `--bg` without ids cannot be stopped on remove (look it up by worktree path); auto-selection resumes a stopped session through POST /open (lead decides: intended, or a Resume button).
- Startup: mutating routes are live before poll and resume (answer 503 until ready, or serialize `session.open`); the data-folder character check runs after `session.created` (move it into validation).
- Session self-approval: a session can read `<data>\api-token` and edit its own settings and hook files (add deny rules `Read(<data>/api-token)` and `Edit(<data>/**)`); raw terminal input can answer Claude Code's own permission prompt (gate it on the PermissionRequest hook and the hold button, own capability for terminal input).
- Git and paths: `git fetch` without `--`, no refusal of a leading `-` in branch or remote names; Windows device names (`aux`, `nul`, `com1`) pass `validateTaskName`; inspect and add check `DRIVE_PATH` on the input string, not the realpath (symlink to a UNC share); `where claude` searches the current folder first.
- Stored data: the first prompt stays verbatim in `action.started` params in state.db; raw `error.message` and CLI stderr in logs need a shared redaction helper.

**M2: UX, renderer and docs**
- Session view: failed-start reason truncated without `title`; Reattach shown for a session that never started; copy-list hints never reach the UI; xterm `minimumContrastRatio` 4.5 on the light theme; TerminalView reuse path; StrictMode double POST /open in dev.
- Dialogs: setup status words show raw ids (ok, hint, problem, info) and the e2e pins them; no branch error when the branch field is cleared; selection after a start can jump to the first row; trust poll runs a full inspect every 2 s; project menu keeps a stale error and removes without confirm.
- Renderer client: no unit tests for backoff, 401 refetch and 4401 reconnect; `host.orchtopusTerminal` ships in production for the e2e; xterm font not rebuilt on a theme switch.
- Spec and plan text: trust terminal is killed without `/exit`; `git fetch` writes `FETCH_HEAD` and remote refs (Done-when 6); "running" has no time bound for `working` / `idle`; `fix: null` for several setup items; plan says minimum 2.1.302 and lacks `@types/better-sqlite3 9.6.0`; extra scope (single-instance lock, `startup-step.ts`, `envelope-event.ts`, standalone bundle plugin).

**M3: hard-block set**
- PR block misses `eval`, `iex` / `Invoke-Expression`, `source <(...)`, `bash <<<`, PowerShell `-Command` prefixes such as `-Comm`, `cmd /cgh ...`, backtick and backslash escapes, heredoc bodies, `gh api`, `-EncodedCommand`, `Start-Process`.

**Backlog**
- Hardening: `connect-src` allows every loopback port; `writePortFile` failing after listen leaks the server; `app.exit(1)` leaves `api.json`; trust terminals have no idle timeout or count; 1008 close without a terminate fallback; `elsewhere` read from output text; a prompt starting with `-` gets a leading space.
- Refactors: four copies of temp-plus-rename; `z.object` vs `z.strictObject` and the repeated StartSessionInput schema; store pass (step after fail, prepare per event, prefix routing, insert semantics, weak projection asserts); `resolveBase` `base: ''`; module-level envelope listener; double `matchSession`; `KEPT_FIELDS` per mode; export `EXCLUDE_LINE`; test helper under `src/main`; cli.ts maxBuffer error, `where` timeout, `whereClaude` untested.
- Perf and rare cases: trust read twice per inspect; one `check-ignore` per file; a remote named `team/acme`; detached HEAD falls back to `main`; stat and cp errors per copy-list entry; `rememberStart` not logged; `Read(/.env)` semantics in user settings; launcher `chcp` not restored (after Task 17).
- Tests and tooling: shared `e2e/helpers.ts`; `dialogs.spec.ts` teardown without `?.` and a request listener never removed; fake CLI liveness is pid-only; a settings fixture path that looks like a person name (rename to `Zoë demo`).
- Design polish (needs DESIGN.md or tokens): dialog scrim and `size.dialog` token; list min and max and stroke 1.5 as tokens; terminal frame header, lamp halo, octopus; danger tint for destructive confirms; input focus rule vs the 2 px ring; `.btn:active` scale on keyboard presses; green check in the trust step; aria-live in the copy button; no-projects note; Figtree and JetBrains Mono not bundled.

## Open decisions

- **Addendum on Claude Code best practices** (`docs/specs/2026-11-27-claude-code-best-practices-addendum.md`): approved by the user on 2026-11-27 with the merge of pull request 6. It overrides the product spec where they differ (auto mode by default, minimum Claude Code 2.1.302, Stop hook check, simpler context management, extended learnings). It adds five questions to the M1 spike. D1 (auto mode) still depends on the spike. Read it before the M1 spec.
- From the spike, to settle in the M1 spec:
  - Background sessions, per the docs, move into `.claude/worktrees/` inside the repository and commit, push and open a draft PR when they finish. The user allows the worktrees in `.claude/` (see "Decisions by the user"), so `worktree.bgIsolation` can stay at its default if the folder is not pushed. The automatic commit, push and draft PR still collide with the release gate: block them with a workflow instruction and the hard-block hooks, and test it before code depends on it.
  - A rule for stale `working` / `idle` in `claude agents --json` (after Esc on a prompt and after a `Stop` hook continuation). The same value appears briefly at process start, so the rule needs a time or hook condition. `blocked` / `idle` is not a reliable "asked a question"; `stopped` appears after `claude stop`.
  - The terminal permission prompt is live while the `PermissionRequest` hook waits: the card must close when the terminal answers first.
  - The classifier inbox (`PermissionDenied`), the "auto mode paused" state and the effect of `autoMode.environment` rest on the docs only. Build them so they degrade to nothing if the hook never fires. D1 stands provisionally until a classifier decision is observed.
  - Parked dangerous commands: keep the spec's pause-session fallback as an option; not working around a park was seen in 3 single runs only.
  - Side chat: recheck that `--strict-mcp-config` empties the tool list before relying on it.
- Local API token: per app start or per installation.

## Gotchas

- Never send `/model` into a session: it saves the model as the user's default for new sessions. Set the model with `--model` at start. The same care applies to every slash command that writes user settings.
- `--tools ""` keeps MCP connector tools. The side chat command needs `--strict-mcp-config` as well.
- `claude --bg` needs workspace trust for the folder (stored in the user's `~/.claude.json`). The add-project step must handle an untrusted folder.
- Keys written to a fresh `claude attach` PTY before the TUI has rendered are dropped. Wait for the prompt box.

- Anthropic's Agent SDK terms do not allow third-party products to offer claude.ai login. Orchtopus therefore drives the user's own installed `claude` CLI and never handles the login itself. Keep it that way and do not switch to the SDK without an API key.
- Transcript JSONL files and `~/.claude/jobs/` are internal formats. Do not parse them.
- Some hook features need a newer Claude Code than 2.1.292 (`onFailure` from 2.1.295). Check the installed version at app start.
- `glab` is not installed on this machine. GitLab code needs tests against recorded CLI output and a manual check on the user's other machine.
- The prototype has no flows for command palette, context and usage display, or crash recovery.
- TypeScript is held at 6.0.x until typescript-eslint supports 7 (peer `<6.1.0`).
- No `@vitejs/plugin-react`: Fast Refresh needs an inline script that the CSP blocks. Do not add it without a CSP plan.
- CSS for the renderer is linked from `index.html`, not imported from TS. CSS imported from JS is injected as `<style>` in dev and blocked by the CSP.
- The sandboxed preload must stay CommonJS. Do not add `"type": "module"` to `package.json` without forcing the preload format.
- `ELECTRON_RUN_AS_NODE` in the environment breaks `npm run dev` and `smoke:native`.
- The Vitest config is `vitest.config.mts`. `package.json` has no `"type"` field, and Vite warns for a `.ts` config.
- `.gitattributes` forces LF. Without it, Windows CI fails Prettier and the workflow regex tests.
- e2e launches pass `colorScheme: null`. Playwright otherwise forces the light colour scheme and the dark-mode test cannot pass.
- `getLastWebPreferences` is missing from the Electron 45 types. e2e uses it through a type-only cast. Re-check it on an Electron upgrade.
- `ORCHTOPUS_BACKGROUND_WINDOW=1` makes the app show its window without taking focus. The e2e suite sets it.
- npm 11 skips the install scripts of node-pty and better-sqlite3 (allowScripts gate). The bundled prebuilds load without them.
- `npm audit` reports 6 moderate advisories (minimatch through electron-builder), none high. Upgrade in its own PR.
- A red check that launches a broken package shows an Electron error dialog on the desktop.
- Known gap: CI does not run `npm run package`.
- In three handover themes the decision card chrome is hard-coded amber, also for the danger and PR cards. Do not copy that.

## Gotchas from M1

- xterm needs the CSP exception `style-src-elem 'self' 'unsafe-inline'` (security.ts, index.html), reviewed by the security-reviewer. Keep the renderer free of innerHTML. After a WebGL context loss the DOM renderer loses 24-bit colours (the CSP blocks style attributes) and logs CSP violations the e2e does not check.
- The main process sets `NoDefaultCurrentDirectoryInExePath=1` before any child process, so libuv never runs a `git.exe` or `where.exe` from a repository folder. libuv reads it from the parent; a child env alone does not help. Claude Code processes get `claudeEnv()`, which drops it, so cmd.exe in the user's sessions behaves as usual. git and `where` keep it.
- Flaky git and session-service tests under 100 % CPU (EPERM on temp cleanup, timeouts with many workers). Done: test timeout 30 s in `vitest.config.mts`, a `removeDir` retry loop in `src/main/test-helpers/temp-repo.ts`, waiting for the PTY exit before removing fake folders, a `check-ignore` retry in `detect.ts`, a stable repo snapshot in the e2e. Left: node-pty "AttachConsole failed" traces and one vitest worker crash seen on Windows; watch CI.
- F6 is the way out of a terminal, because xterm keeps Tab and Esc for the PTY. F6 moves to the selected row (session view) or to Close terminal (trust step). Both show the hint "F6 leaves the terminal".
- The fake CLI kills a command hook without a `timeout` after 60 s; real Claude Code waits 600 s by default. Do not read hook timing from the fake.
- `--permission-mode` takes `manual`, not `default`.
- Electron fuses: keep `RunAsNode` on; the hook launcher runs the app's executable in Node mode. Packaging must not flip it silently.
- A stale `api.json` after a crash can point hooks at a port another local process holds, and that process gets the token. Accepted in M1 (a pid check was added); revisit in M2, where hooks carry decisions. Spooled events carry no token: never let them drive privileged actions.
- Once the data folder location is configurable, `bin\` must not be writable by others.
- A dev `state.db` from before 37db898 lacks `context_at` (MIGRATION_1 was edited in place). Delete the dev data folder.
- Dev watch mode does not rebuild `out/main/hook-helper.js` when only the helper changes.
- A failed start after `session.created` answers 201 with the failed SessionView.
- For Task 17: `chcp 65001` with a non-ASCII exe path leaves the console code page changed (look at the attached TUI); Claude Code must write `hasTrustDialogAccepted` at once, because closing the trust step kills the PTY; check xterm contrast of the real CLI colours on the light theme.
- Before merge the lead confirms a green windows-latest CI run of the pushed branch.
