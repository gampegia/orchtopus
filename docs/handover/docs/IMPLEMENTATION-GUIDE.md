# Orchtopus – implementation guide

This guide turns the concept (`concept.md`, translated from the German original) into an agentic build plan. Code, comments, commits, UI text and docs in the repo are English (concept E25). The concept is the source of truth for *what*; this guide covers *how to build it*.

## 1. Ground rules

0. **Precedence.** The concept grew over time. Newer decisions override older text: higher E numbers and newer changelog rows win. In particular, E34 and E35 override earlier text that builds on the bridge mod, pad or watch, and the milestones below replace the concept chapter "Umsetzungsphasen".

1. **Question before building.** The concept collects many ideas. Before each milestone, the lead reviews the relevant requirements with the user (superpowers brainstorming), simplifies and cuts what adds no value. Items marked "zu evaluieren" are open.
2. **Out of scope for now:** hardware pad (ESP32, Stream Deck), smartwatch apps, the bridge mod (E34, E35). Keep the architecture open for them: every action goes through the local API, events are subscribable, notifications go through a rule layer with pluggable channels.
3. **Public repo, no project data (E36).** Only generic names in code, tests, fixtures, screenshots and docs (`acme-app`, `report-export`, `upload-fix`). Project config, wikis, histories and learnings live in the user folder (`%APPDATA%\Orchtopus\`), never in the repo. Before every push, a privacy reviewer agent double-checks the diff for project names and secrets.
4. **Never merge (E24).** Every piece of work ends in a PR on a branch. The user merges.
5. **No unnecessary limits.** Show load and usage, warn, but do not cap sessions, test environments or background jobs by default (F69).
6. **Text style (E32).** Messages to the user: result or next action first, short sentences, numbered steps, no filler (about 80 % ASD-STE100 plus i-have-adhd rules). Talk to the user in German.

## 2. Proposed stack (confirm in the first brainstorming)

| Area | Proposal | Why |
|---|---|---|
| App shell | Electron (decided, E14) with electron-vite, TypeScript strict | `node-pty` + xterm.js is the proven path for real terminals |
| UI | React + TypeScript, CSS variables for design tokens | Large ecosystem; themes as token files (E27) |
| Terminal | xterm.js + `node-pty` (ConPTY on Windows) | Same approach as VS Code |
| Local state | SQLite (e.g. better-sqlite3) + append-only event log | Crash recovery, idempotent actions (F75) |
| Local API | HTTP on 127.0.0.1 with per-start token, server-sent events or WebSocket for events | Hooks and later clients (pad, watch) use the same API |
| Config and content | JSON/Markdown files with schemas (e.g. zod), hot reload | Building blocks with versions (E33) |
| Markdown in panels | remark/markdown-it + a code highlighter | Rendered chats and plan editor (F50, F61) |
| Git providers | `gh` and `glab` CLIs behind one provider interface | E30 |
| Tests | Vitest (unit), Playwright for Electron (E2E) | Gates for the app itself |

Agent adapter (E35): the UI only talks to an `AgentAdapter` interface (start, attach, send input, read status and events, answer permission, read context fill and limits). First adapter: PTY + official Claude Code hooks reporting to the local API + status line. Verify which hooks and timeouts the installed Claude Code version offers before building on them.

## 3. Milestones

Each milestone: brainstorm (scope cut) → spec → plan → subagent-driven implementation with TDD → review council → PR. The user approves spec and plan.

| # | Milestone | Main requirements | Done when |
|---|---|---|---|
| M0 | Repo and tooling | E14, E25, E33, E36 | Electron app starts, lint/types/tests run in CI, CLAUDE.md and agents in repo, README draft |
| M1 | Walking skeleton | projects, worktrees, one real session in a terminal, agent adapter, local API, state store | Open a demo project, start a session in a worktree, see live output and status after an app restart |
| M2 | Needs you | permissions via hook, decision cards (F51, F52), dangerous commands (hold to allow), inbox, notifications | A permission request shows inline with explanation; allow/deny reaches the session; fallback to terminal works |
| M3 | Workflow | superpowers phases and gates, spec/plan view with rendered editor and advisor (F38–F41, F49, F50), side chat (F61, F63) | Plan review, change requests reset gates, advisor hands steps to sessions only after user click |
| M4 | Review and PR | review detail, review council, PR/MR draft and release (E24), GitHub/GitLab pipelines, reviews, comments (E30, F60), split PR | Draft released by the user creates a PR/MR; failed pipeline shows in the inbox |
| M5 | Robustness and usage | crash recovery (F75), context management (E31, F62), usage view (F67), models and effort per role (F68), resources and ports (F69) | Kill the app mid-session, restart, continue with one click |
| M6 | Look and feel | design tokens and themes (E27, F55, F56), Stellwerk default + Island Landscape + Tinted Glass, settings, keymap and command palette (F73), text style (F65) | Theme and mode switch instantly; new theme = new folder |
| M7 | Project wiki | E28, F57, F58, F64 | Wiki opens from the app, updates after a merge, every technical claim links to file and commit |
| M8 | Extras | project onboarding (F71), learnings (F72), investigate session type (E29, F59), stacked PRs/MRs (F74), secret filter (F70), updates of building blocks (F66) | Each feature behind its own PR |

M0–M4 form the first usable version. Parallelise only after M1 exists; M6 and M7 can run in parallel with M5.

## 4. Visual reference

- `mockups/index.html`: four screens in five themes, dark and light. Preferred: **Island Landscape** and **Tinted Glass**; **Stellwerk** is the calm default. Same layout and components for all themes; only tokens and theme effects differ.
- `mockups/prototype.html`: clickable behaviour simulation in an older visual style. Use it for flows, not for looks. Its pad, watch and simulation panels are out of scope.
- Signal colours carry meaning and always come with a text label: amber permission, violet spec or plan, green PR or done, red danger or stalled, orange overlap, blue running.
- Every UI change goes through the unslop design skill (E26) and its checklist.

## 5. How to run the build agentically

**Lead:** one Claude Code session with Fable as the model. It owns the milestone plan, talks to the user, dispatches work and keeps its own context small. It does not write large amounts of code itself.

**Backbone: superpowers.** Use the full loop per milestone: brainstorming → writing-plans → subagent-driven-development (with TDD, worktrees, two-stage review) → finishing-a-development-branch (always as PR). Keep plans in `docs/plans/`, specs in `docs/specs/`.

**Workers:** custom subagents in `.claude/agents/` (templates in this pack) with an explicit model:

| Agent | Model | Job |
|---|---|---|
| implementer | Opus | One plan task, test first, small commits |
| spec-reviewer | Sonnet | Does the task match spec and plan? |
| code-reviewer | Opus | Correctness, structure, error handling |
| security-reviewer | Opus | Local API, IPC, permissions, secrets, Electron hardening |
| ui-reviewer | Sonnet | unslop checklist, tokens only, contrast, signal colours with labels |
| privacy-reviewer | Sonnet | No project names or secrets in the diff (before every push) |

Quality over token thrift: Opus for implementation and the critical reviews, Sonnet for checklist reviews. Raise effort for planning and security.

**Parallel work:** after M1, independent tasks or milestones can run in parallel worktrees. Options:
- background subagents from the lead (default, simplest),
- Agent Teams (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) when two streams must coordinate, e.g. theme system and settings UI,
- a workflow run for broad, verification-heavy jobs such as a full privacy and security audit before the first public push.

**Context hygiene:** one milestone per lead session where possible. At the end of a session the lead writes `docs/progress.md` (done, next, open decisions, gotchas). The next session starts from that file plus concept and plan.

**Definition of done per task:** tests green, lint and types clean, reviewers have no open blocking findings, UI checked with unslop, no project names, commit message in Conventional Commits.

## 6. Skills and tools to install

| What | How | Scope |
|---|---|---|
| superpowers | `/plugin install superpowers@claude-plugins-official` | user |
| unslop (design, heydamir) | `claude plugin install unslop --marketplace heydamir/unslop --scope project` (check the repo README for the current command) | project |
| i-have-adhd (output style, optional) | `claude plugin marketplace add ayghri/i-have-adhd` then `claude plugin install i-have-adhd@i-have-adhd` | user |
| frontend-design (Anthropic, optional) | from the official plugin marketplace | project |
| GitHub CLI | `gh auth login` | machine |

Verify current install commands in each project's README before running them.
