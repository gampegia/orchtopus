# Addendum: alignment with current Claude Code best practices

Date: 2026-11-27
Status: approved (2026-11-27, by the user with the merge of pull request 6)
Parent: `docs/specs/2026-11-26-orchtopus-product-design.md`. Where this addendum and the parent differ, the addendum wins once it is approved.

## Intent

Orchtopus sets up and supervises Claude Code sessions. The setup it gives those sessions should follow what the official Claude Code documentation recommends today, not what was common when the concept was written.

Rule from the user (2026-11-27): where a current best practice and our spec differ, follow the best practice, unless a lot depends on the spec's choice.

## Sources and how reliable they are

- Reference: the official documentation at `code.claude.com/docs/en/` on 2026-11-27: `best-practices`, `memory`, `permission-modes`, `auto-mode-config`, `permissions`, `costs`, `features-overview`, `hooks-guide`, `hooks`, `skills`, `sub-agents`, `worktrees`, `sandboxing`, `headless`, `goal`, `scheduled-tasks`, `cli-reference`.
- Secondary: Anthropic blog posts on context engineering, skills, loops, managed agents and harness design, and two third-party articles. They gave ideas, not requirements. Their performance numbers are vendor statements without published evidence and are not used here.
- The pages were read by research agents through summaries. The hooks reference and the sandboxing page were read only in part. Every item under "Spike additions" is undocumented or unverified and must be tested before code depends on it.
- Installed on the development machine: Claude Code 2.1.292.

## Decisions

### D1. Sessions run in auto mode by default

Since Claude Code 2.1.283, interactive sessions start in `auto` permission mode: a classifier approves most actions, and deny rules and hooks still apply. The documentation recommends auto mode plus deny rules over hand-made allow lists.

- Orchtopus starts sessions with `--permission-mode auto`. Each project can be set to `default` (manual) or `plan`. Never `bypassPermissions`.
- This supersedes concept decision E8 (no automatic approval) and the sentence "always the default mode or stricter" in the parent spec, section 5.2.
- The safety layer does not depend on the classifier:
  - The `PreToolUse` hook for dangerous commands stays. A hook's deny holds in every permission mode. Dangerous commands are still released only by holding the button in the app.
  - The three hard blocks (force push, push to the default branch, creating or merging a PR) stay as hooks.
  - Deny rules for secrets are passed with `--settings`: at least `Read(./.env)`, `Read(./.env.*)`, `Read(./secrets/**)` and the user's SSH key folder. A deny rule cannot be overridden by an allow rule or by a hook.
  - The dangerous-command hook sets `onFailure: "block"`, so a crashed or timed-out hook blocks the action. This closes the open point "hook errors must never fail open" in the parent spec, section 10.
- Orchtopus generates an `autoMode.environment` text per project (the repository's remotes, the package registries and domains the user confirms) and passes it with `--settings`. Every list keeps the literal `"$defaults"`. It is never written to the project or to the user's settings.
- What the user sees:
  - Permission cards appear where Claude Code still asks: ask rules, manual-mode projects, and whatever the spike shows for auto mode.
  - An action the classifier blocks becomes an inbox entry (from the `PermissionDenied` hook) with the reason and the choices allow once, add a rule, leave it.
  - When auto mode pauses itself (3 blocks in a row or 20 in total), the session shows "needs you".
- Known limit: the classifier is not deterministic. It reduces interruptions; it is not a guarantee. Everything that must hold is a hook or a deny rule.

### D2. Minimum Claude Code version

Orchtopus requires Claude Code 2.1.295 or newer, the documented floor for `onFailure` on command and http hooks, and checks the version at app start and when a project is added. Below 2.1.332, the version the spike and M1 were tested on, it shows "not tested on this version". The earlier reasons for 2.1.302 (auto mode and manual-mode defaults) do not apply, because Orchtopus passes `--permission-mode` explicitly. An older version shows a clear message with the update command; Orchtopus does not update Claude Code itself. Basis: `docs/evidence/claude-code-setup.md` [EV-H10] (corrected 2026-11-28).

### D3. Base setup of every session, all from outside the repository

- `--settings <file>`: hooks, deny rules, the project's "always allow" rules, `autoMode`.
- `--append-system-prompt-file`: the workflow instructions.
- `--agents <json>`: Orchtopus' own agents.
- `--plugin-dir <dir>`: Orchtopus' own skills and hooks as one plugin. `--add-dir` for a project's skill folder in the data folder.
- Never `--bare` for supervised sessions: it skips hooks and skills and needs an API key instead of the user's login.
- Orchtopus never triggers these commands in a session, because they write into the project or into the user's own settings: `/fewer-permission-prompts`, `/auto-mode-setup`, `/sandbox`. Their purpose is covered differently:
  - `/fewer-permission-prompts`: Orchtopus suggests "always allow" rules from its own event log and stores accepted ones in its own rule store (see D8). With auto mode the need is small.
  - `/auto-mode-setup`: replaced by the generated `autoMode.environment` in D1. The setup check (D9) tells users that they can run the command themselves for sessions outside Orchtopus.
  - `/sandbox`: see "Not adopted".

### D4. Sessions check their own work before they stop

"Give Claude a check it can run" is the first recommendation of the documentation.

- When a project has fast check commands (type check, lint), Orchtopus adds a `Stop` hook that runs them. A failure goes back to Claude (exit code 2) so it fixes the problem before it reports "done".
- The hook reads `stop_hook_active` and exits early when it is set. Claude Code itself ends the loop after 8 blocks in a row without a tool call.
- The hook has a time budget: a setting, own default 60 seconds [EV-H3]. A check that takes longer is skipped with a hint in the inbox. Tests are opt-in per project for the same reason.
- On by default when fast commands are known, with a switch per project.
- This supersedes, for these fast checks only, the rule in the parent spec, section 5.4, that skipped steps become hints and never send the session back. Everything else stays light: no follow-up prompts, no block on edits before plan approval.

### D5. Goal runs, opt-in

After the plan is approved, the user can start "work until done" for a session. Orchtopus sends `/goal` with a condition built from the plan's done criteria and a turn clause ("or stop after N turns").

- `/goal` is a research preview and has no hard turn limit of its own. Orchtopus therefore stops the run itself: usage thresholds, stalled detection, and the fix-round budget.
- Off by default, behind a setting. Orchtopus checks that the command exists in the installed version.
- The five questions of the documentation for unattended runs are answered by existing parts: done (approved plan and gates), self-check (D4 and the gates), scope (worktree, deny rules, hard blocks), stop (this section), sign-off (the user releases the PR).

### D6. Background jobs have fixed bounds

Reviewers, the wiki generator, summaries and the advisor fallback run as `claude -p` processes.

- `--permission-mode dontAsk` with an explicit tool list, `--max-turns` and `--max-budget-usd`. Defaults are set per role in the M4 spec and can be changed.
- Review agents get `tools: Read, Grep, Glob` and no Bash. The `tools` list does not limit what Bash can do.
- Not `--bare` (needs an API key).
- These bounds are safety caps for unattended jobs. They do not cap the user's own sessions, so the "no unneeded limits" rule holds.

### D7. Context management is simplified

The documentation lists "managing context aggressively" under things to stop doing: the window is large and compaction is automatic.

- This supersedes concept decision E31: no thresholds at 40, 60 and 75 percent, no automatic handoff file, no orchestrated `/compact`.
- Orchtopus shows the context fill and suggests a fresh session at a task boundary.
- The `PreCompact` and `SessionStart` (after compaction) hooks only put the workflow state back (phase, path of spec and plan).
- Nothing is written into the worktree. The one exception in the concept (`.orchtopus/handoff.md`) is gone.

### D8. Learnings are the self-improvement loop

The learnings feature (F72) already is a self-improvement loop with a human gate. It is extended, not replaced.

- Consolidation pass: a read-only background session reads the learnings store and Orchtopus' own event log, merges duplicates, replaces stale entries, and writes a candidate. The user sees the difference and accepts, changes or discards it. Every version is kept and can be rolled back.
- More sources: review findings, causes of fix rounds, blocked and denied commands, repeated corrections, and Claude Code's own auto memory folder (read-only, documented location, plain Markdown).
- More targets: "always allow" suggestions for Orchtopus' rule store, and a "Gotchas" section in the skills Orchtopus ships or the project keeps in the data folder.
- Nothing is applied without the user's confirmation. Changes to a project's `CLAUDE.md` go through a normal PR.
- Orchtopus does not redirect `autoMemoryDirectory`: the user's sessions outside Orchtopus should see the same memory.

### D9. Setup check per project

A read-only check when a project is added, and on request later:

- Claude Code version (D2).
- A check Claude can run exists (test, lint or type check command).
- `CLAUDE.md` is under 200 lines [EV-H8], has no emphasis words in capitals, and does not describe what the code already shows.
- Secrets are covered by deny rules (D1 adds them for Orchtopus sessions in any case).
- superpowers is installed.
- A hint that `/doctor prompt-audit` exists.

Results are suggestions in the inbox. A light version (version, runnable check) belongs to the add-project step in M1; the full check belongs to onboarding (F71) in M8.

### D10. Orchtopus' own prompts and skills follow the same rules

- The workflow instructions and the text style block are short and contain only what a session cannot see. No emphasis words in capitals. Hard rules are hooks, not text.
- Each `SKILL.md` stays under 500 lines. A skill with side effects sets `disable-model-invocation: true`.
- A unit test in this repository checks these points for every shipped building block.

### D11. Files to copy into new worktrees

Each project has a list of git-ignored files (for example `.env`) that Orchtopus copies into a new worktree, the equivalent of `.worktreeinclude`. The list lives in the Orchtopus data folder.

## Not adopted

| Item | Reason |
|---|---|
| Sandbox | Not supported on native Windows. If a project runs under WSL later, `sandbox.enabled` can be passed with `--settings`. Never set `sandbox.failIfUnavailable` on Windows: Claude Code would exit. |
| "Dreaming" | Only in the Claude API (managed agents, research preview). Orchtopus drives the user's CLI without an API key. D8 is the local equivalent. |
| `/loop` and `/schedule` | Timed loops spend usage while idle, and the concept has no scheduled agents. |
| `--bare` | See D3 and D6. |
| A coordinator with cloud threads | Orchtopus is the local coordinator. Cloud sessions are out of scope. |

## Spike additions for M1

In addition to the table in the parent spec, section 10:

1. Does a `PermissionRequest` hook fire for actions in auto mode, and for which? What does the `PermissionDenied` hook deliver?
2. Do hooks, deny rules and `autoMode` passed with `--settings` work in interactive and in `--bg` sessions on Windows?
3. Does `onFailure: "block"` block when the hook process crashes or times out?
4. Does a `Stop` hook passed with `--settings` run in `--bg` sessions, and is `stop_hook_active` set as documented?
5. Does `/goal` work in a `--bg` session, and can Orchtopus read its state?

If item 1 or 2 fails, D1 falls back to manual mode with the permission cards of the parent spec, and the user is told.

## Effect on the milestones

| Milestone | Change |
|---|---|
| M1 | Five more spike questions, the minimum version check (D2), the base setup (D3), the light setup check (D9), the worktree file list (D11). |
| M2 | Permission cards are no longer the main path in auto mode. New: inbox entries for classifier blocks and for a paused auto mode. Dangerous commands and parking are unchanged. |
| M3 | The `Stop` hook check (D4). Optional goal runs (D5). |
| M4 | Bounds and flags for reviewer processes (D6). |
| M5 | Context management shrinks to display and a suggestion (D7). |
| M8 | Learnings with consolidation, more sources and targets (D8). Full setup check (D9). |
| All | The test for building blocks (D10) starts with the first shipped prompt or skill. |

The principles of the parent spec do not change: nothing is written into the user's repositories unasked, the three human gates stay, Orchtopus never merges, dangerous commands need the hold button, and the app drives the user's own CLI.

## Open points

- D1 depends on the spike. Until then it is the intended default, not a proven one.
- How much the classifier costs in usage per session is not documented. Measure it in the spike.
- The default bounds in D6 and the turn clause in D5 need numbers from real runs.
