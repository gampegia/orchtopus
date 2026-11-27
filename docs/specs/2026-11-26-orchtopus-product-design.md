# Orchtopus product design

Date: 2026-11-26
Status: draft, waiting for approval
Scope: the whole product. Each milestone gets its own spec and plan that refine this document.

This spec is the result of going through the concept (`docs/handover/docs/concept.md`) with the user. Where this spec and the concept differ, this spec wins. Everything the spec does not mention stays as the concept describes it. Requirement IDs (E, F, N, P, G) refer to the concept.

## 1. Intent

One person runs several Claude Code sessions in parallel, in a few Git repositories, on Windows, with superpowers as the working method. Today that means jumping between terminal windows to check three things: is everything still running, does something need a permission, is something stalled.

Orchtopus removes that jumping. One window shows every session with its state, brings every decision to the user with an explanation, and carries finished work through review to a pull request that the user releases.

Success: the user can answer "what is each session doing, what is next, where am I needed" in three seconds without clicking, and never has to look into a separate terminal window to find a waiting permission prompt.

## 2. Goals, non-goals, anti-goals

**Goals**
- All sessions of all open projects in one window, each with a state that is visible at a glance.
- Permissions, spec and plan approvals, stalled sessions and failed pipelines come to the user, in the app and as Windows notifications.
- A gated workflow on top of superpowers: spec, plan, test-driven implementation, automatic gates, review council, pull request.
- Sessions and decisions survive an app crash or restart.
- The full scope of the concept is built, core first, the rest soon after. Nothing is cut for size alone.

**Non-goals**
- Hardware pad, smartwatch apps, bridge mod (E34, E35). The architecture stays open for them.
- Editor or full file explorer (E15). Control of the official Claude desktop app.
- Multi-user or team operation. Billing in money.
- macOS and Linux for now (E13).

**Anti-goals** (failure even if it technically works)
- A permission or a dangerous command is approved without a deliberate user action in the app.
- Orchtopus merges, or creates a PR or MR that the user did not release (E24).
- Orchtopus writes files into the user's project repositories without the user asking for it.
- Real project, company or person names, secrets or private paths end up in this public repository (E36).
- Limits that are not needed: capping sessions, test environments or background jobs by default (F69).
- State shown only by colour, without a text label (F53, N6).
- Enforcement that sends Claude into loops or blocks the user's work.

## 3. Constraints

- Windows 10 and 11, x64. Claude Code is driven through the user's installed `claude` CLI with the user's own login. Orchtopus never handles the login and does not use the Agent SDK with subscription credentials.
- Claude Code internals change quickly. Before a milestone builds on hooks, status line fields, background sessions or resume, the lead checks the current documentation and the installed version. Findings so far are in `docs/progress.md`. Items marked "test" there need a spike.
- Internal formats of Claude Code (transcript JSONL, `~/.claude/jobs/`) are not parsed.
- Public repository, English only, generic demo names only.
- Git providers: GitHub (`gh`) and GitLab (`glab`), both required. `glab` is not installed on the development machine; GitLab code is tested against recorded CLI output and checked manually on another machine of the user.

## 4. Approaches

How Orchtopus talks to Claude Code:

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Installed CLI behind an adapter:** background sessions (`claude --bg`, `claude attach` in a PTY), official hooks reporting to the local API, status line for context fill and limits | Works with the subscription login, sessions survive the app, uses only documented features. Some behaviour on Windows is undocumented and needs a spike. | **Chosen** (user agreed) |
| B. Agent SDK | Clean programmatic control, but needs an API key instead of the subscription and the whole session UI must be built. | Rejected |
| C. Bridge mod first | Richer events and commands, permission hold without hook timeout. The mod interface is new and still moving. | Deferred; can become a second adapter later |

Fallback inside A, if background sessions do not behave on Windows: the session runs as a child process in the app's PTY with a pre-assigned `--session-id` and is recovered with `--resume`. Running tool calls and subagents are lost in that case. The `AgentAdapter` interface hides which variant is used.

## 5. Decisions from the brainstorming

### 5.1 Layout and views

- **The session view is the home screen.** The app starts in the last state; there is no separate "open project" screen. A project is added through a dialog.
- **Left sidebar:** every session of every open project, grouped by project, each with a signal lamp and a word: running, needs you, stalled, ready for review, idle, done. Task progress where known.
- **Centre:** decision card above the real terminal of the selected session, with a line "Also waiting" for other sessions that need the user. Project terminal below, collapsible (E23, F36).
- **Right column:** overview, changes, gates as tabs; side chat docked below (E21).
- **Inbox:** one list of everything that needs the user across projects, reachable by key. Every case also appears as a card above its session (F51).
- **Board:** secondary view, built in M5 and simpler than in the concept (columns by state, cards open the session). The backlog column comes with it.
- Detail views (plan and spec, diff, review detail, PR detail) have back, close and Esc (F40).

Sketch of the session view:

```
┌ Orchtopus ── acme-app ▾ ───────────────────────── Inbox 2 ┐
│ Sessions            │ ▲ Permission: npm install …        │ Overview   │
│ ● report-export  needs you │ [Allow once] [Deny] [Ask advisor] │ Task 12/15 │
│ ● upload-fix     running   │ ─────────────────────────────── │ Gates      │
│ ● i18n-de        stalled   │  Terminal (real claude)          │ ────────── │
│ ○ changelog      idle      │                                  │ Side chat  │
└─────────────────────┴────────────────────────────────────┴────────────┘
```

### 5.2 Sessions and adapter

- One worktree per task, one session per worktree (E10).
- The UI knows only the `AgentAdapter` interface: start, attach, send input, read state and events, answer a permission, read context fill and limits.
- First adapter as in approach A. Session state comes from `claude agents --json` plus hook events; superpowers phases from hook events on skill use and from spec and plan files.
- Input to a session (course correction, plan go, handoff) is delivered after the current task by default, with "interrupt now" as an explicit option (F63).
- Sessions started outside Orchtopus are not managed. From M5 the sidebar lists them as "external" with their state only, without cards or gates.
- superpowers is expected in the user's Claude Code setup; Orchtopus checks for it when a project is added and offers the install command. Orchtopus' own agents and hooks are shipped as building blocks and passed to each session at start (`--settings`, `--agents`, `--plugin-dir`), never written into the user's setup. Third-party review plugins are checked for and offered, not installed silently.
- No fixed limit on the number of sessions. The app shows count, subscription usage and machine load.

### 5.3 Permissions

- A `PermissionRequest` hook reports to the local API and waits for the user's decision. The card shows the command, what it does, risk hints, and the buttons Allow once, Always allow in this project, Deny, Ask the advisor (F52).
- **Waiting time:** default 10 minutes, configurable (the concept's 60 seconds came from the bridge-mod design). After that, and whenever the app is not reachable, the normal prompt appears in the session's terminal and waits there. The card stays and says "answer in the terminal". Nothing is ever allowed by timeout or error.
- "Always allow in this project" is stored in Orchtopus' own rule store for that project in the data folder and passed to every session of the project through `--settings`. This keeps the rule out of the repository and makes it valid in all worktrees.
- Dangerous commands: only "Hold to allow once" for one second in the app. No rule, no hotkey, no remote client. The list of dangerous patterns is a versioned file.
- Every decision is logged before it is carried out; repeating an action does nothing twice (F75).

### 5.4 Workflow, gates and enforcement

- superpowers runs the workflow inside the session. Orchtopus shows the phase and stops at three human gates: spec, plan, release of the PR. For spec and plan the stop is the one superpowers already makes: the session waits in its chat for approval, Orchtopus shows the gate as a card and sends the approval or the change request as a message. No extra hook blocks edits before plan approval.
- **Enforcement is light** (user chose this over a strict mode). Three hard blocks through a `PreToolUse` hook, each with a reason Claude can read: force push, push to the main branch, and any creation of a PR or MR by a session. Orchtopus is the only path to a PR or MR: the release button checks that required gates are green, pushes the branch if needed and creates it. A session may push its own feature branch. Everything else that looks skipped (for example a commit without a test run) becomes a hint in the inbox, not a block. There is no automatic "go back and do it" loop for skipped steps.
- **Gates are configurable commands.** Shipped and on: tests, lint, types, secret scan, dependency and CVE audit. Shipped and off by default: static analysis, diff budget, test locally.
- A red automatic gate triggers an automatic fix round, at most 2 by default (configurable). After that the case goes to the inbox with a summary of what was tried.
- **Review council** with four roles: spec compliance first (blocking), then code quality (includes leanness), test quality, and security only when sensitive paths are touched; then a synthesizer that verifies, de-duplicates and ranks findings. The list is editable per project, and a project can add its own reviewers for special concerns (for example accessibility, database migrations, translations) as agent files in the data folder. Review depth scales with the size of the change: a small diff gets a light pass, a large one the full council. Where a well-tested skill or plugin from a trusted source does the job, Orchtopus uses it instead of its own reviewer (see section 8).
- **Where checks run:** Orchtopus runs gate commands itself as processes in the worktree. Review council members run as separate headless Claude Code processes that Orchtopus starts, each with a fresh context, so results survive a crash and do not fill the session's context. A fix round goes back to the session as a normal message with the findings. The exact signal for "ready for review" is defined in the M4 spec.
- **Git and PR check without an agent:** branch name, commit format and target branch are checked by fixed rules. A suggestion to split a PR comes from the advisor on request.
- A change request resets the gates from lint onwards; spec and plan stay approved (F41). Small tasks may use the short form for spec and plan.

### 5.5 Review, pull requests and providers

- Review detail and PR draft as in the concept (F42, F43): what was done, gates, findings, diff, draft with title and description. The user releases; Orchtopus then creates the PR or MR. It never merges.
- GitHub and GitLab from the start behind one provider interface (E30).
- The PRs view in M4 covers the user's own PRs and MRs, their pipelines and comments, and review requests addressed to the user. A failed pipeline creates an inbox entry (F60).
- Diff in the app is read-only: file tree, comparison against the base branch, buttons to open the worktree or the diff in VS Code (E20).
- Reviewing other people's PRs with agents (F45) moves to M8. Stacked PRs (F74) stay in M8.

### 5.6 Advisor and side chat

- The side chat is a fork of the session without tools. It reads the session's history but cannot act and leaves the session untouched. Fallback: a fresh call with a condensed context (plan, diff, recent messages).
- The same advisor is available in plan, diff, review and PR views with the context of that view (F39). Chats in panels are rendered Markdown, not terminals (F61).
- **Handoff is simplified:** the advisor drafts an instruction, the user edits it, the user sends it. Orchtopus delivers it to the session as a normal message. The intermediate step "check with sessions" from F49 is left out for now and may return in M8. Nothing reaches a session without the user's click.

### 5.7 Storage

- Orchtopus keeps all its data in one data folder: default `%APPDATA%\Orchtopus\`, location selectable in settings (for example a synced folder or a private Git repository). It holds project configuration, rule stores, wikis, learnings and building-block overrides. The state database (sessions, events, inbox, decisions, usage) always stays on the local machine under `%APPDATA%\Orchtopus\`, because a database in a synced folder breaks with two writers. Sharing the data folder between machines therefore shares settings and content, not running state.
- Nothing is written into project repositories by default. Hooks and settings reach a session through `--settings` with a file outside the repository; workflow instructions through `--append-system-prompt-file`. This replaces the managed `CLAUDE.md` section (E17, F30) as the default. Writing project rules into the repository stays an explicit, optional action.
- Files that superpowers itself writes into the worktree (specs, plans) are part of the user's normal workflow and are not affected.
- The local API listens on 127.0.0.1 only and requires a token. Whether the token is created per app start or per installation is decided in M1; hooks read it from a file in the user profile at each call.

### 5.8 Design

- The mockups in the handover pack are inspiration only. Before any UI is built, the design is explored: a UI library is chosen with the user, then at least six directions are produced as HTML mockups (light and dark, the same core screens each), compared on one page and iterated until the user picks one. The result is recorded in `DESIGN.md` with tokens and theme structure.
- Components use design tokens only, from M1 on. Themes are folders (E27).
- The pet is an animated pixel-art octopus that reacts to the session state and can be switched off (M6). It is a small customisable character: several styles and accessories with some humour, selectable in settings, and built data-driven as a versioned building block so that a new style or accessory is a small change. Levels and experience points are not planned.
- Interactions get a motion pass with the design skills so that clicks and state changes feel smooth; motion stays calm and respects the Windows "reduce motion" setting.
- "Orch"-themed naming may be used where it fits and stays clear.

### 5.9 Smaller simplifications

- Adding a project comes in two stages: a simple version in M1 (choose folder, detect test, lint and type commands, confirm) and the full onboarding with suggestions and a trial run in M8 (F71).
- Wiki (M7): updated after a merge and through a button "update now". The second-agent fact check stays. Previews for feature branches are left out for now.
- Building blocks (E33): files with a version, reloaded on change, user changes kept separate from shipped ones. One-click rollback and an update UI come in M8.
- Freely movable panels (F48) are only prepared in the architecture.

## 6. Stack

These are the lead's choices; the user left the "how" to the lead.

| Area | Choice |
|---|---|
| App shell | Electron with electron-vite, TypeScript strict |
| UI | React, CSS variables for design tokens; UI library chosen in the design step |
| Terminal | xterm.js with node-pty (ConPTY) |
| State | SQLite with an append-only event log |
| Local API | HTTP on 127.0.0.1 with token, event stream for subscribers |
| Config and content | JSON and Markdown files with schemas, hot reload |
| Git providers | `gh` and `glab` behind one interface |
| Tests | Vitest for units, Playwright for Electron end to end |

Electron hardening applies from M0: context isolation on, no Node integration in renderers, narrow preload API, no remote content with privileges.

## 7. Milestones

Each milestone runs: brainstorming, spec, plan (user approves spec and plan), subagent-driven development with TDD in worktrees, review by the agents, PR. Parallel work starts after M1.

| # | Content | Done when |
|---|---|---|
| Design | UI library choice, at least six mockup directions, comparison, `DESIGN.md` | The user has picked a direction. Runs in parallel with M0. |
| M0 | Repository tooling: Electron app starts, lint, types and tests in CI | A window opens; CI is green |
| M1 | Walking skeleton: add a project (simple), one real session in a worktree, adapter, local API, state store, sidebar with state. Starts with a spike on background sessions, hooks and status line on Windows. | Start a session, close the app, reopen it: live output and state are back. If the spike forces the fallback adapter, the criterion becomes: the conversation is resumed with one click; a separate supervisor process is then decided with the user. |
| M2 | Needs you: permission cards, dangerous commands, inbox, stalled detection, Windows notifications | A permission request appears as a card with explanation; allow and deny reach the session; the terminal fallback works; a stalled session is reported |
| M3 | Workflow: superpowers phases, human gates, spec and plan view with rendered editor, side chat and advisor with simplified handoff, the three hard blocks | Plan review and go from the app; a change request resets gates; a handoff reaches the session only after a click |
| M4 | Review and PR: gates runner, review council, review detail, diff, PR and MR draft and release, pipelines and comments for GitHub and GitLab | A released draft creates a PR or MR; a failed pipeline appears in the inbox |
| M5 | Robustness and usage: crash recovery view, context management, usage, models and effort per role, resources and ports, board, overlap warning, test locally | Kill the app in the middle of a session, restart, continue with one click |
| M6 | Look and feel: theme system and settings, further themes, keymap and command palette, text style, pixel octopus | Theme and mode switch instantly; a new theme is a new folder |
| M7 | Project wiki | The wiki opens from the app and updates after a merge; technical claims link to file and commit |
| M8 | Extras, each as its own PR: full onboarding, learnings, Investigate session type, stacked PRs, secret filter, building-block updates with rollback, review of other people's PRs, "check with sessions" | Each feature is merged separately |

After M2 the user's main problem is solved: one window, all sessions, permissions and stalled sessions at a glance. M0 to M4 form the first complete workflow. M6 and M7 can run in parallel with M5.

Requirements marked "Must" in the concept mean "must be there by M8".

## 8. Reuse of existing skills and tools

Principle: prefer well-tested, popular skills and tools from trusted sources over own implementations, and keep every reviewer and gate replaceable through configuration. The list below is the lead's proposal from a check of current sources on 2026-11-26. The milestone specs for M3 and M4 confirm each item against the versions current at that time.

**Reviewers**

| Role | Default | Source |
|---|---|---|
| Per-task review during implementation | superpowers' own reviewer (spec compliance and code quality in a fresh subagent per task) | [obra/superpowers](https://github.com/obra/superpowers), MIT |
| Spec compliance at the end | Own `spec-reviewer` agent. No existing reviewer knows the spec. | this repository |
| Code quality, including leanness | `code-reviewer` and `code-simplifier` from pr-review-toolkit, or the built-in `/code-review` as a one-call alternative | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official), Apache-2.0 |
| Test quality | `pr-test-analyzer` from pr-review-toolkit | same |
| Security, on sensitive paths | One of: the `security-guidance` plugin (hook based) or the built-in `/security-review`. Not both. | same |
| Synthesizer | Own agent | this repository |

**Changes to the concept that follow from current practice**

- The synthesizer does more than de-duplicate. It first verifies each finding against the code and drops what it cannot confirm, then de-duplicates and ranks by severity. This mirrors the find, verify, rank pipeline of Anthropic's own code review.
- Findings are routed by kind, not only by severity. Every confirmed defect enters the automatic fix loop, however small: bugs, spec failures, security issues, missing or wrong tests. Only findings that are not defects (style, naming, optional refactoring, matters of taste) go into the PR description as a checklist. The review detail offers a button to have the session work through that checklist as well. No known bug is left in on purpose.
- Reviewers get a fresh context and only read; runtime checks belong in the automatic gates.
- A CVE finding in a dependency that the change did not touch is reported as a hint with an offer to start a dependency-update session; it does not block the current PR.
- The fix cap stays at 2 by default (superpowers itself allows up to 5 with escalation to a stronger model). It is configurable, and after the cap the case goes to the user.

**Further gates**

| Gate | Tool | Licence |
|---|---|---|
| Secret scan (on by default) | gitleaks | MIT |
| Dependency and CVE audit (on by default) | `npm audit` for JavaScript projects, osv-scanner for other lockfiles | Apache-2.0 (osv-scanner) |
| Static analysis | Semgrep CLI (rules carry their own licences) or trivy | LGPL-2.1, Apache-2.0 |
| Diff budget | Own check. No sourced recommendation for a line limit exists; the default of 400 net lines from the concept stays and is configurable. | this repository |

External tools are called as installed binaries and are never bundled. A gate whose tool is missing shows as "not installed" and does not fail.

## 9. Left to the builder

- Internal module layout, IPC design, database schema, event names, API routes.
- The exact `AgentAdapter` method signatures.
- Choice of Markdown renderer, diff component and file watcher.
- Polling intervals, as long as state changes show within about 2 seconds (N2).
- How the background-session spike is carried out, as long as its findings are reported before M1 is planned in detail.

## 10. Open points for later milestones

- Token lifetime of the local API (M1).
- Whether the terminal prompt is visible while the permission hook waits, and the maximum hook waiting time (M1 spike).
- How model and effort per role map to what Claude Code allows per agent (M5).
- Which third-party stack tools, if any, are worth using for stacked PRs (M8).
