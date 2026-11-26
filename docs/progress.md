# Progress

Last update: 2026-11-26 (session 1, lead: Fable)

## Done

- Handover pack read in full (concept, implementation guide, templates, mockups, prototype).
- Repository created locally with `main`. Handover pack copied to `docs/handover/`, renamed from the working title to Orchtopus, concept translated to English (`docs/handover/docs/concept.md`).
- `CLAUDE.md`, agents in `.claude/agents/`, `.gitignore`, `LICENSE` (MIT, to be confirmed), `README.md`.
- Skills: unslop installed at project scope (`.claude/settings.json`), `pick-ui-library` installed to `.claude/skills/`. superpowers and i-have-adhd already exist at user scope.
- Claude Code internals checked against the current docs (see below).

Agents used in this session: mockup and prototype analysis 2× Sonnet; concept translation 4× Sonnet (medium); Claude Code research 2× claude-code-guide; install command check 1× web-fetch; privacy review 1× Sonnet (high).

## Next

1. User confirms the licence and the first push (public repo on GitHub).
2. Step 3: brainstorm the whole concept with the user (cut, simplify, defer), confirm stack and milestones. Result: spec in `docs/specs/`.
3. Step 4: design exploration (UI library choice with `pick-ui-library`, at least six directions in `docs/design/explorations/`, comparison page, then `DESIGN.md`).
4. M0, then M1.

## Decisions by the user (session 1)

- Name: Orchtopus. "Orch"-style naming is welcome where it fits, also for the pixel-art pet.
- Public repo on GitHub under the user's account. Everything in the repo is English.
- The human gate at the end is "release PR", not merge (E24 overrides G10 and F17).
- Nothing in the user's project repositories if avoidable. Storage location should be selectable.
- GitLab is required (available on another machine of the user, not on this one).
- Mockups in the pack are inspiration. More and more varied design explorations are wanted, made with the design skills, realistic for the workflow.

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

- Licence: MIT proposed.
- Session lifecycle, side chat and enforcement: recommendations above, to be confirmed in the step 3 brainstorming and verified by a spike in M1.
- Data folder: default `%APPDATA%\Orchtopus\`, selectable in settings; optional sync through a private Git repo or a synced folder.
- Local API token: per app start or per installation.
- Priorities: almost every requirement from F55 on is marked Must, but several sit in M7 and M8.

## Gotchas

- Anthropic's Agent SDK terms do not allow third-party products to offer claude.ai login. Orchtopus therefore drives the user's own installed `claude` CLI and never handles the login itself. Keep it that way and do not switch to the SDK without an API key.
- Transcript JSONL files and `~/.claude/jobs/` are internal formats. Do not parse them.
- Some hook features need a newer Claude Code than 2.1.292 (`onFailure` from 2.1.295). Check the installed version at app start.
- `glab` is not installed on this machine. GitLab code needs tests against recorded CLI output and a manual check on the user's other machine.
- The prototype has no flows for command palette, context and usage display, or crash recovery.
- In three handover themes the decision card chrome is hard-coded amber, also for the danger and PR cards. Do not copy that.
