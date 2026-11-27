# Progress

Last update: 2026-11-26 (session 1, lead: Fable)

## Done

- Handover pack read in full (concept, implementation guide, templates, mockups, prototype).
- Repository created locally with `main`. Handover pack copied to `docs/handover/`, renamed from the working title to Orchtopus, concept translated to English (`docs/handover/docs/concept.md`).
- `CLAUDE.md`, agents in `.claude/agents/`, `.gitignore`, `LICENSE` (MIT), `README.md`.
- Skills: unslop installed at project scope (`.claude/settings.json`), `pick-ui-library` installed to `.claude/skills/`. superpowers and i-have-adhd already exist at user scope.
- Claude Code internals checked against the current docs (see below).

Agents used in this session: mockup and prototype analysis 2× Sonnet; concept translation 4× Sonnet (medium); Claude Code research 2× claude-code-guide; install command check 1× web-fetch; privacy review 1× Sonnet (high).

## Next

**Build M0 now.** Spec: `docs/specs/2026-11-27-m0-tooling-design.md`. Plan: `docs/plans/2026-11-27-m0-tooling.md` (11 tasks, approved by the user on 2026-11-27).

How to run it:
1. Create a worktree and branch `feat/m0-tooling` from `main`.
2. Use superpowers:subagent-driven-development: one `implementer` agent per plan task (Opus, medium), in order, each task ends with green checks and a commit. Review after each task as the skill describes; follow-ups go to the same agent.
3. When all tasks are done: `code-reviewer` and `security-reviewer` (Opus, high) on the whole branch, `spec-reviewer` (Sonnet) against the M0 spec, privacy review before the push.
4. Open the PR, wait for CI on GitHub to be green, then merge (the lead merges after a review without open blocking findings).
5. Update this file, then ask the user to run `/clear` before M1.

Things the plan leaves to find out during M0: whether Electron exposes `node:sqlite` (task 8 reports it), and whether the prebuilt binaries of `node-pty` and `better-sqlite3` load in Electron on Windows without a rebuild.

After M0: M1 starts with a spike on background sessions, hooks and status line on Windows (see the table of assumptions in the product spec, section 10).

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

## Findings: Claude Code internals

Installed: Claude Code 2.1.292 (docs changelog is at 2.1.331). Items marked *test* are not confirmed by the docs and need a spike in M1.

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

## Open decisions

- Session lifecycle, side chat and enforcement follow the spec; the M1 spike verifies the items marked *test*.
- Local API token: per app start or per installation.

## Gotchas

- Anthropic's Agent SDK terms do not allow third-party products to offer claude.ai login. Orchtopus therefore drives the user's own installed `claude` CLI and never handles the login itself. Keep it that way and do not switch to the SDK without an API key.
- Transcript JSONL files and `~/.claude/jobs/` are internal formats. Do not parse them.
- Some hook features need a newer Claude Code than 2.1.292 (`onFailure` from 2.1.295). Check the installed version at app start.
- `glab` is not installed on this machine. GitLab code needs tests against recorded CLI output and a manual check on the user's other machine.
- The prototype has no flows for command palette, context and usage display, or crash recovery.
- In three handover themes the decision card chrome is hard-coded amber, also for the danger and PR cards. Do not copy that.
