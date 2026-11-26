# Orchtopus – Concept and Requirements

Nov 23, 2026

Orchtopus is a dedicated Windows desktop app that manages several Claude Code sessions across projects. It shows what each session is doing right now and plans to do next, collects everything that needs you in one place, and enforces a workflow with gates (spec, plan, TDD, review, CI). Together with the mockups, this document is the template for the implementation.

## Goal and scope

Orchtopus must answer three questions in three seconds: What is each session working on, what comes next, and where do I need to step in? It must also start new work cleanly and bring finished work cleanly through review and merge.

**Target group:** one person (at first only you) who runs several Claude Code sessions in parallel in several Git repos on Windows and works with Superpowers.

**Goals**

- Overview of all sessions of a project and across projects: state, current task, next task, subagents.
- One single place (inbox) for everything that needs you: permissions, plan go, stalled sessions, red gates.
- Start, steer and end work, from the app and with the pad.
- Open a project and restore everything, even after the app was closed hard.
- Workflow according to best practice for AI-assisted programming: spec, plan, TDD, automatic gates, review council, human approval at merge.

**Non-goals**

- No replacement for the official Claude desktop app and no control of it.
- No own editor or file explorer: the IDE does that.
- No cost accounting in money; the use of the Max quota is shown, however (F67).
- No automatic permissions without your click, except through the normal permission rules of Claude Code.
- No multi-user or team operation in the first stage.

**How to use this document:** It describes requirements and decisions; the mockups (v2) show the look. For the implementation, a Claude Code session gets both. Before that, it checks the points under "Limits, risks and checkpoints" against the current docs and first builds the prototype from phase 0. Where a mockup and the document contradict each other, the document applies.

**Question it before implementation:** Many options here are proposals from conversations and mockups, not final decisions. Whoever reads the concept in for implementation should first go through them together (e.g. with superpowers:brainstorming), simplify, and delete what brings no benefit. Points marked **to be evaluated** are explicitly open.

**Pad and smartwatch: idea only (E34).** Everything about the pad (ESP32, Stream Deck, pad protocol, designs A–D) and the smartwatch (Wear OS, other ecosystems) is background for the system design, not an implementation task. Where requirements say "also on pad and watch", read it as a later extension. For the system design this means: Every action that you can trigger in the app (permission, reject, switch session, status) runs through the local API and not directly from the interface; states and events can be queried and subscribed to through the same API; notifications go through a rules layer to which more channels can be attached later; devices would sign in with their own token. Dangerous commands can still only be permitted in the app.

## Terms

| Term | Meaning |
| --- | --- |
| Project | A folder with a Git repo, e.g. `~/code/acme-app`. The unit that you open and restore. |
| Session | A Claude Code session with its own ID and its own history. Runs as a background session and belongs to exactly one worktree. |
| Worktree | A Git worktree with its own branch. One per task, so that sessions do not get in each other's way. |
| Main agent / subagent | The agent of the session and the agents that it starts (e.g. implementer, reviewer in Superpowers). |
| Inbox | List of all items that need you, across all sessions and projects. |
| Gate | Checkpoint in the workflow. Automatic (tests, lint …) or human (spec, plan, merge). |
| Review council | Several specialised review agents plus a merge step. |
| Bridge mod | Claude Code mod in every session. Reports events to the app, accepts commands, holds permissions. |
| Local API | HTTP interface of the app on `127.0.0.1`, used by the bridge mod, hooks, pad and Stream Deck. |
| Pad | ESP32 macropad with display (optionally Stream Deck), connected to the app by USB serial. |
| Overlap | Two worktrees of the same repo change the same file. |

## Fundamental decisions

Every decision has an ID, so that later changes can refer to it. Status "decided" means: it applies until a new entry replaces it.

| ID | Decision | Reason | Rejected alternatives | Status |
| --- | --- | --- | --- | --- |
| E1 | Own desktop app that runs the real `claude` (CLI) in embedded terminals | Full control over sessions, focus and keys; runs with your normal login and subscription; all mods keep working. | Remote-control the official desktop app: no API, no link to existing Code sessions, only fragile window tricks. Agent SDK: according to the docs it requires an API key instead of the subscription login, and the interface must be built completely from scratch. | decided |
| E2 | Sessions run as background sessions (`claude --bg`), the app attaches to them | Sessions survive closing the app; restoring is then only "attach again". | Sessions as child processes of the app: they die with the app, restoring only through `--resume` with an interruption. | decided, check first (P1) |
| E3 | The bridge mod in every session supplies data, the app draws its own panels | Mods see everything relevant (tool calls, tasks, agents, turns) and can hold permissions. Own panels are freer and work across sessions. | Draw mod interfaces natively: no documented protocol for foreign apps. Only settings hooks: they see less, no commands back. | decided |
| E4 | Additionally settings hooks (`Notification`, `Stop`, `PermissionRequest` …) as a second source | They run in every session, also without a mod; robust fallback source for state. | – | decided |
| E5 | The inbox is the only place for "needs you" | In v1, a permission from another session appeared in the panel of the active session. One place prevents mix-ups and allows keyboard and pad control. | Permissions per session panel; state duplicated in sidebar and board. | decided |
| E6 | The right panel shows only the active session | Clear separation: board = all, session = one, inbox = what needs you. | Mixed panels as in v1. | decided |
| E7 | Permissions: the bridge mod holds the call (`tool.check`), waits for your click with `$.http.fetch`, and after 60 s falls back to the normal terminal question | Waiting time in mod API calls does not count toward the hook time limit; structured data (tool, command); safe fallback. | Write keys into the terminal (breaks when dialogs change). Wait for a pane button in a mod (counts toward the time limit, the command would run). | decided, check first (P2) |
| E8 | No automatic permissions for "trusted" sessions | Traceability. Permanent permissions belong in the permission rules of Claude Code. | Auto-approve as in claudectl. | decided |
| E9 | Superpowers as the standard workflow, gates enforced by the app | Proven flow (brainstorm, spec, plan, worktree, TDD, review, wrap-up); the app only adds visibility and gates. | Invent an own workflow. | decided |
| E10 | One worktree per task | Isolation; basis for the overlap warning and clean PRs. Superpowers does this anyway. | Several sessions in the same working folder. | decided |
| E11 | Review council: first spec fidelity (blocking), then specialists in parallel, then merge step | Checking the spec first saves work on wrong code; parallelism saves time; the merge step prevents duplicate findings. | A single reviewer (too broad). Several agents voting on the same question (expensive, only useful for security on delicate changes). | decided |
| E12 | Fixed checks before agents (lint, types, audit, Semgrep, diff budget) | Cheap, deterministic; agents do not have to search for what tools find. | Everything by agent. | decided |
| E13 | Windows first | Your workplace. ConPTY, Windows Terminal, USB serial on Windows. | macOS first. | decided |
| E14 | App framework: Electron (with `node-pty` and xterm.js) | Both can do webview + PTY. Tauri is smaller, Electron has the shortest path with `node-pty` + xterm.js. | Tauri: smaller and more economical, but backend in Rust and PTY less proven | decided: Electron |
| E15 | No own file explorer; instead worktree tree and tree of changed files | Claude navigates by itself; when reviewing, only what was changed counts. | Full file tree. | decided |
| E16 | Settings on two levels: global defaults, project overrides individually | Same rules for all projects without copying; deviations are visible and can be reset. | Only project settings (a lot of double maintenance). Only global (too rigid). | decided |
| E17 | Structured things as switches and menus, rules in words as free text that is written into a managed section of the CLAUDE.md | Switches can be checked and enforced by the bridge mod; free text reaches Claude directly through the CLAUDE.md, which Claude Code reads anyway. | Everything as free text (not enforceable). Everything as a form (too narrow for project knowledge). | decided |
| E18 | The workflow is enforced by default, in two ways: instructions in the CLAUDE.md and blocks by the bridge mod | Instructions alone are sometimes ignored; blocks alone do not explain why. Together they lead Claude reliably through the steps and trigger a new round on red. | Only instructions. Only blocks. | decided, check first (P8) |
| E19 | Side chat through $.model.fork: history of the session plus your question, without tools, without an entry in the session, not saved | Help and off-topic questions without interrupting or filling the session; it reads along, does not steer. | Question directly in the session (interrupts, fills context). Own session per question (heavy, saved). /btw of the desktop app (not in our app). | decided, check first (P9) |
| E20 | Diff in the app, open in VS Code by button | Short review without switching; the familiar editor for deep work. | Only VS Code. Own editor. | decided |
| E21 | Right column in two zones: at the top session info with tabs, at the bottom the side chat as a dock; depending on window width tab, dock or own column | Questions mostly arise while reading the info; both must be visible at the same time. The terminal stays untouched as the main area. | Chat replaces the panel (v2 · 6: info gone while asking). Chat as a dock under the terminal (takes height from the terminal). Chat as an overlaying drawer (covers the terminal). | decided |
| E22 | Pets only with own or self-loaded characters, no brand logos | Logos and mascots are protected; own characters are free and can be tailored to states. | Ship animated variants of the Claude logo. | decided |
| E23 | Own project terminal as a collapsible panel under the main session, start in the project root | Quick commands (git, dev server, package manager) without switching windows and without interrupting Claude. At the bottom as in VS Code, so that the session above stays fully readable. Project root as default, because commands mostly affect the whole repo; worktree of the session can be switched. Strictly separate from Claude: nothing lands in the history of the session. | Open an external Windows Terminal (only as an additional button); terminal as a tab instead of a panel; run commands through the Claude session (clutters the history, costs tokens). | decided |
| E24 | Orchtopus never merges itself; every piece of work ends in a PR that you approve | A merge needs review, CI and branch protection of the repo; GitHub is the right place for that. A PR draft saves writing work, the approval keeps control with you. | Merge directly from Orchtopus (bypasses repo rules); create the PR automatically without approval | decided |
| E26 | Every new or changed interface runs through the design skill unslop by heydamir before the merge | The skill checks spacing, color, icons, texts, type, layout, details, visuals and animation in a fixed order and keeps the direction. This keeps the interface consistent and stops it from sliding into typical AI patterns, even when many sessions work on it. | Apply it only once at the draft; only general design rules without a skill | decided |
| E27 | The interface is built with design tokens and replaceable themes; light/dark and several design variants can be chosen in the settings | Several variants are liked (Signal Bloom, HUD Brackets, Prism Glass); the choice should be changeable later without a rebuild. If components only know tokens, Claude can create a new theme as one file without touching components. | One fixed design with colors directly in the components (every change touches many files); full theme editor for users (too much effort for the start) | decided |
| E28 | Every project gets a wiki as an HTML file outside the repo, which Orchtopus updates automatically after merge or push | You want to be able to read the current state in an understandable way without filling the repo with generated files. A single HTML file opens in any browser, needs no server and can contain diagrams and expandable depths. | Wiki in the repo (docs/), because then it would have to be reviewed and merged too; GitLab/GitHub wiki (tied to the provider, no altitude levels); only maintain the README (too flat) | decided |
| E29 | Investigate becomes its own session type, not its own mode with its own interface | An investigation needs other gates and a different result (findings instead of code and PR), but the same interface: terminal, plan, advisor, inbox. A session type changes template, permissions and wrap-up without building a second world. | Own mode with its own view (double effort); normal feature session with a longer plan (TDD and PR gates do not fit, session might change code too early) | decided |
| E30 | GitHub and GitLab are connected through their CLIs (gh, glab), behind a common interface per project | Both CLIs deliver pipeline status, logs, reviews and comments as JSON and use the existing sign-in. This way you see failed pipelines and colleagues' reviews in Orchtopus, without managing own API clients and tokens. | Only GitHub (GitLab merge requests would be left out); own REST clients (more code, own token management); only links to the browser | decided |
| E31 | Orchtopus controls the context of each session itself: it measures the fill level, suggests at safe points a fresh session with handoff or targeted compaction, and secures the state beforehand | Even with 1 M tokens, performance drops when the context is full, and automatic compaction can lose details. The built-in threshold cannot be set reliably. Orchtopus knows plan, gates and rest points and can therefore better decide when and how. | Rely only on the built-in auto-compact; never renew the session (performance drops); compact automatically at every threshold without a backup | decided |
| E32 | Standard text style for everything that Claude writes to you in Orchtopus: about 80 % ASD-STE100 plus i-have-adhd rules | You should not be overwhelmed by text. ASD-STE100 makes sentences short and unambiguous, i-have-adhd puts the next action first and cuts filler. Not 100 %, so that texts stay naturally readable. | Full ASD-STE100 (too stiff, restricted vocabulary); no style (long answers); style only on request | decided |
| E33 | Orchtopus is split into independently versioned building blocks, so that small changes (e.g. wiki structure) can be rolled out without much effort | Orchtopus will be developed for a long time, often with itself. If prompts, skills, templates, workflows and themes are files instead of built-in logic, one file is enough for many changes, without a new app version. | Everything in one app version (every small thing needs a build and installation); changes only manually in every place | decided |
| E34 | Pad (ESP32, Stream Deck) and smartwatch are idea only and will not be implemented for now; the system design keeps them possible | Orchtopus itself should run first. If all actions run through a local API with events and notifications go through a rules layer with several channels, pad and watch can be connected later as further clients, without a rebuild. | Build pad and watch right away (ties up time, hardware questions open); drop them completely (the architecture would make them harder later) | decided |
| E35 | The bridge mod is idea only. Orchtopus talks to Claude Code through an agent adapter layer; in the first step through terminal, official hooks and status line | The mod interface is new and can change. With an adapter layer, the bridge mod can be added later as a further adapter, without rebuilding the interface, inbox or gates. | Build and test the bridge mod immediately (ties up time to a moving interface); write keys into the terminal as the main path (breaks when dialogs change) | decided |
| E36 | Project-related data never lives in the Orchtopus repo; mockups, examples and docs use generic names | The Orchtopus repo will become public on GitHub. Project configuration, wikis, histories and learning notes live in the user folder outside the repo. | Real projects as examples (data leak); project data in the app folder of the repo | decided |

## Architecture

&#91;embedded content: Architecture · App, sessions, bridge mod, hooks, pad\]

The sessions run as background sessions of Claude Code and do not need the app. The bridge mod in every session reports events to the local API and fetches commands and permission decisions by long poll; settings hooks are a second, simpler source. The app attaches its terminals with `claude attach`, saves everything in its database and runs gates and Git commands. Pad and Stream Deck talk through the same API as the interface.

## Views and workflow

Every view answers exactly one question. Terminals exist only in the session view; "needs you" only in the inbox.

| View | Question | When | Contains | Deliberately does not contain | Mockup |
| --- | --- | --- | --- | --- | --- |
| Open project | What am I working on today? | App start, project switch | Recently opened, "Since you were away", what is restored, project settings | Terminals | v2 · 1 |
| Board | What is running, what is to do, what do I start? | Morning, in between, after breaks | Cards per session in columns (Needs you, Review, Running, Start, collapsed Idle), agent counter, gate status, overlaps, backlog from issues and plans | Terminals, diffs | v2 · 3 |
| Session | I am working with this one session. | A decision needs context, steering | Worktree tree (quick switch), terminal with mod elements, right panel only for this session: short summary, tasks, agent tree, gates, send instruction | Foreign permissions, detailed state groups | v2 · 2 |
| Review | Is this finished and good enough to merge? | Card in "Review" | Gates, review council, changed files as a tree, overlaps, merge order, merge button | Running sessions | v2 · 4 |
| Inbox (drawer) | Do I have to do something now? | As soon as badge or pad reports | Permissions, plan go, stalled sessions, conspicuous subagents, red gates after 2 fix rounds | Everything that continues without you | v2 · 3 (open) |
| Pad | React briefly, without reaching for the PC | Any time | List of sessions with state, keys: Allow, Reject, Next "needs you", Open session, New session, Status to all | Details | v1 · 3 |
| Settings | Which rules apply here? | Set up, adjust per project | Workflow, gates, Git, project instructions, notifications, permissions, templates, pad; origin per field | Running sessions | v2 · 5 |
| Side chat | Ask something briefly, without disturbing | Any time in the session view (Ctrl+;) | Questions about plan, code, off-topic; context switches; clear | Control of the session | v2 · 6 |
| Diff and Advise | What exactly changes, and what do I do about conflicts? | From Review or an overlap warning | File tree, diff, comparison with another branch, VS Code buttons, Advise chat | Merge decision (stays in Review) | v2 · 7 |

**Typical daily flow**

1. Start the app, open the project. The app attaches to running background sessions and shows "Since you were away".
2. Board: work through the inbox (plan go, stalled session), open cards in "Review".
3. Review: look at gates and review council, merge or request a change.
4. Start new work from "Start" (issue or plan) with a template.
5. During the day: pad or toast reports something. Simple permission directly at the pad, otherwise inbox, open the session if needed.

**Navigation:** Keys `B` board, `S` session, `R` review, `I` inbox, `J/K` switch in the inbox, `A` allow or go, `D` reject, `O` open, `Ctrl+Tab` next session.

## Settings and enforcement of the workflow

Settings exist on two levels: global defaults for all projects and deviations per project. Every field shows where its value comes from ("Global" or "Project") and can be reset to the default (E16).

| Area | Form | Content | Works through |
| --- | --- | --- | --- |
| Workflow | Main switch + checkboxes + menus | Enforce workflow (default on); steps spec, plan, worktree, TDD, test locally (always / when affected / never), review council, PR+CI; on red new round or inbox; max. fix rounds; short form for small tasks | CLAUDE.md + bridge mod |
| Gates | Table with switch and command per gate | Tests, lint, types, test locally, audit, Semgrep, diff budget | Gate runner |
| Git | Menus + checkboxes + free text | Branch scheme, commit style, merge type, PR target, block push to main and force push, further rules in words | CLAUDE.md + bridge mod blocks |
| Project instructions | Free text (Markdown) with preview | Project knowledge, paths for UI/API, test data rules | managed section of the CLAUDE.md |
| Notifications | Matrix event × channel + quiet time | Pad, toast, phone per event | App |
| Permissions | List | dangerous commands (only "Open" at the pad), fallback seconds, suggestions for permission rules | Bridge mod |
| Templates | List with form | Feature, bugfix, dependencies: workflow, model, permission mode, start prompt | App |
| Pad | Form | Key mapping, brightness, port | App |
| Pets | Switch + selection + load file | on/off, character, size, own sprite sheet, reduce animations | Bridge mod (bar) or app |
| Git refresh | Menu | fetch interval (default 5 min), notice when behind main | App |

**How the workflow is enforced (E18)**

1. **Instructions:** The app writes the active steps, gates and Git rules as plain text into a managed section of the CLAUDE.md (between `<!-- orchtopus:start -->` and `<!-- orchtopus:end -->`). Claude reads it in every session.
2. **Blocks:** The bridge mod rejects in `tool.call` steps that come too early, with a reason that Claude can read. Examples: `gh pr create` while a Must gate is red; `git push` to main; `git push --force`; commit without tests having run before, when TDD is active.
3. **Follow-up:** At `turn.complete` the mod checks whether a due step is missing (e.g. code changed but no tests run; UI affected but not tested locally). If something is missing, it starts a new round with `$.prompt.submit` with a clear instruction, at most as often as "max. fix rounds".
4. **Iterate:** Red gates automatically lead to a new round; only after that does the case go to the inbox. Spec and plan can come back for approval after follow-up questions.
5. **Exceptions:** Small tasks (default: under 30 changed lines) may do spec and plan in short form in the chat. Switching off the main switch applies only to the project and is visibly marked in the board.

## Side chat and Advise

The side chat is a help next to the session: It reads along but does not steer (E19).

- **Open:** Ctrl+; jumps to the input line. The side chat sits as a dock in the lower part of the right column, under the info of the session (layout see below, E21).
- **Technology:** The bridge mod calls `$.model.fork({ prompt })`. This sends the previous history of the session plus your question to the model; the model cannot call tools while doing so, and nothing appears in the session. Earlier questions and answers of the side chat are appended to the question by the app itself.
- **Context switches:** History (default on), plan, diff of the worktree.
- **Off-topic** is allowed (e.g. a TypeScript question), without filling the context of the session.
- **Not saved:** The history lives only in memory; "Clear" deletes it, closing the app does too.
- **No control:** "Copy to instruction" only fills the field "Send instruction". You must send it yourself.

**Advise** is the same side chat, prefilled with a context: at a gate finding, at a finding of the review council or at an overlap (both diffs, both plans). It can make suggestions, such as the merge order; actions like "queue rebase instruction" happen only on click.

**Diff:** In "Review" there is a diff view with file tree, comparison against main or another branch, and the buttons "Worktree in VS Code" (`code <path>`) and "Diff in VS Code" (`code --diff <old> <new>`) (E20).

**Layout of the right column (E21):** Info and side chat are shown at the same time instead of taking turns.

| Window width | Arrangement |
| --- | --- |
| under 1200 px | One column with four tabs: Overview, Changes, Gates, Chat |
| 1200 to 1600 px (default) | At the top the info with three tabs, at the bottom the side chat as a dock. Collapsed, it is only an input line; expanded, the info shrinks to a header line (task, agents, gates), and the chat uses almost the full height so that longer answers stay readable. A click on the header line expands the info again. Button "wider" switches to reading width: The chat takes up just under half of the window, the terminal continues narrower. Chat text 14 px, lines at most about 68 characters wide. |
| from 1600 px | Side chat optionally as its own narrow column to the right of the info |

The "Overview" tab is compact: short summary in one sentence, current and next task, agent counter with expandable tree, gates as chips, instruction field as one line. Details are in the tabs "Changes" and "Gates". "Advise" from Review or a warning opens the same dock with prefilled context.

## Documents, Review and Pull Requests

Added after clicking through the [prototype](../mockups/prototype.html).

**Spec and plan as their own view (F38).** "Review plan" does not open a popup preview. It opens a view like Diff or Review: on the left an editor on the real file in the worktree (`docs/specs/…md`, `docs/plans/…md`), on the right a chat. Superpowers-compliant means: the file stays the only source of truth, and the session re-reads it at Go or after "Report change to session". The chat has two modes: **Question** (the advisor reads spec, plan and history, answers, and can make a suggestion that you apply to the editor with a button) and **Instruction to session** (goes as a message to the session, which revises the document with superpowers:writing-plans or brainstorming). A bar checks the plan against the rules of writing-plans: per task the files, first a failing test, a command to run it, one commit. Plan Go and "Spec is OK" sit at the top of this view.

**Advisor chat everywhere you review (F39).** Diff, Plan, Review and other people's PRs have the same chat on the right, with the context of the view. You do not need to switch to another view to get advice. It reads, but it does not control anything. History per context, can be cleared.

**Close and Back (F40).** All detail views (Diff, Plan/Spec, review detail, PR detail) have "← Back" and ✕. Esc also goes back. The app keeps a history of views.

**Request changes (F41).** You write yourself what should be different. The text goes as a message to the session. After that, Orchtopus resets lint, tests, review council, Git check, PR approval and CI to open, the session goes back to "running", and after the change all gates and the review council run again.

**Review detail (F42).** A click on a tile in "Review" opens its own view: what was done (tasks, commits), gates and findings of the review council, Git and PR check, test locally, PR draft, and the advisor chat on the right. From there you can go to Diff, the session history or VS Code.

**Pull requests instead of merge (E24, F43).** Orchtopus never merges by itself. The end is always a PR: Claude writes a draft (title, description with What/Why/Tests/Checklist, target branch by project rule, optionally as draft), you edit and approve it, then Orchtopus runs `gh pr create`. Merging happens on GitHub, following the branch protection and reviews of the repo. "Squash" is only the merge type on GitHub here: all commits of the branch become one commit on the target branch. Branch rules (for example feat/fix/chore → develop, main only through a release PR, push to main/develop blocked) are in the project settings and are checked by the Git hooks and the Git reviewer. After the merge, Orchtopus offers to remove the worktree and the local branch.

**Git and PR reviewer (F44, to be evaluated).** Its own agent after the review council: branch name, commit format, target branch, whether the CI configuration of the repo covers the changed paths, whether the PR is cut cleanly or is better split into several PRs (with a suggestion how). Which checks are worth it, and how automatic a split may be, must be brainstormed before implementation.

**Review other people's PRs (F45, to be evaluated).** The "PRs" view lists open PRs/MRs of the repo (via `gh` or `glab`). Agents (code, security for matching paths, tests, leanness, Git) write a review draft. Each finding can be ticked, and the result can be chosen (Comment, Request changes, Approve). It is only sent after a click. "Check out locally and test" creates its own worktree. Benefit, cost and the choice of agents are to be evaluated.

**Test locally with start profiles (F46).** When UI or API are affected, review detail offers "Test locally". Start profiles are in `.orchtopus/project.json`, for example `api` (worktree) and `web` (another repo, such as `acme-web`, on the branch of the same name, otherwise develop, with `API_URL` pointing to the local API). Claude suggests profiles the first time from package.json/README, and you confirm. The second repo is searched for or chosen once. Output and links are in the review detail, and you stop it with a button.

**Resizable areas (F47).** The dividers between the main area and the side panel, between info and side chat, and above the terminal can be dragged. Sizes are saved per project. Scroll positions stay in place when new output arrives.

**Modular layout (F48, later).** Do not build it yet, but build so that it becomes possible: views consist of panels (project tree, terminal, info, chat, gates …) that sit in a layout grid. Later you can move them, for example the side chat to the left under the project tree.

**From advisor to session: agreed steps (F49).** An advisor chat (Diff, Review, Plan) must not only talk. When you discuss something and want it implemented (for example how an overlap is resolved, "Split PR", "Add test for 29 February"), the advisor writes a **proposed plan** with one step per affected session. You can edit the steps, use **Check with sessions** to ask each session whether the step fits its current work (it answers "agreed" or with an objection), and only with **Send to sessions** do they go out as an instruction. Nothing reaches a session without your click. A "resolved" button without an action no longer exists. "Plan resolution" takes its place.

**Rendered editor for spec and plan (F50).** The default is the rendered view: blocks become editable as Markdown in place when you click, and checkboxes can be ticked directly. Next to it is a switch to plain Markdown.

**What needs you sits directly above the session (F51).** Permissions, spec, plan, stalled session, overlap and PR draft appear as a card above the terminal of the affected session, in addition to the inbox. A line "Also waiting" shows which other sessions need you. The spec card shows the open questions with an answer field.

**Permissions without an extra dialog (F52).** No popups with a checkbox. The permission card (session, inbox, pad C) shows the command, an explanation of **what it does**, risk notes and the buttons *Allow once*, *Always allow in this project* (writes a rule to `.claude/settings.json`), *Deny*, *Ask the advisor*. Dangerous commands: only *Hold to allow once* (hold for 1 s), no rule, not on pad or watch.

**Colors by type of decision (F53).** Amber = permission, violet = human gate spec/plan, green = PR draft/PR, red = dangerous or stalled, orange = overlap, blue = running or plan from the advisor. Each card also carries a text label. Color is never the only information.

**Additional buttons that were missing in the spec (F54):** Pause/Resume per session, re-run gate, re-run lint and tests, Split PR (stacked PR drafts), regenerate description, copy PR text, update PR, edit start profiles, open terminal for a stalled session, send answers to spec questions, open plan/spec from the overview, list of project rules in the settings.

**Language (E25).** The interface, commands, code, comments and commits of the app are in English. This concept was translated from the German original.

**Design direction (to be decided).** Six proposals, each dark and light, on the mockup page (row "Design directions"): 1 Graphite Precision, 2 Mission Control HUD, 3 Bento Ops, 4 Glass Layers, 5 Swiss Editorial, 6 Industrial Control. The basis is the design skills for coding agents that are widespread in 2026: [impeccable](https://impeccable.style) (colors in OKLCH, radius tokens, visible labels, one main action, a list of forbidden "AI slop" patterns), [taste-skill](https://github.com/Leonxlnx/taste-skill) (minimalist and industrial-brutalist registers) and [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (style library, including Bento Grid, Glassmorphism, Dark Mode). Common rules for all: one color per type of decision plus a text label (F53), text contrast at least WCAG AA in light and dark, no nested cards, no purple gradients, terminal never transparent. For the implementation, it is recommended to install one of these skills in the repo and to record the chosen direction as DESIGN.md.

**Layered styles L1–L5 (favorite direction).** From your feedback: panels stand out through tone and shadow instead of thin borders (like Pop and Clay), areas have different tints instead of one color for foreground and background (like Aurora and Glass light), rather rounded. Variants: Paper Layers, Soft Pop, Clay Studio, Tinted Glass, Floating Islands, each light and dark. Signal colors are the same and strong in all five (amber permission, violet spec/plan, green PR, red dangerous, blue running, orange overlap). The main action of a decision carries its signal color, and everything else stays neutral. Rules from Anthropic's frontend-design skill: 4–6 core colors, one focal point, no uniform card grids, labels in sentence case, monospace only for commands. Styles 7–14 were removed.

**Shortlist: Clay Studio and Floating Islands.** Five color versions each, light and dark. Clay Studio: Porcelain, Sage, Oat, Lavender, Topo (line pattern in the background). Floating Islands: Dawn (gradient), Ocean (waves), Mesh (color blobs), Dot grid, Landscape (illustrated landscape). The islands stay neutral so the content has full contrast, and the sidebar and detail panel are slightly translucent. Signal colors stay the same in all versions.

**Design unslop as a fixed step (E26).** For the interface, the skill [unslop by Damir Sokolovsky (heydamir)](https://github.com/heydamir/unslop) is used (license CC BY 4.0, keep the attribution). Installation in the app repo: `claude plugin install unslop --marketplace heydamir/unslop --scope project`, and commit `.claude/settings.json` so that every session has it. Process per interface: audit against the skill's list, direction in five lines, then the nine passes in order and the checklist at the end. The direction is in `DESIGN.md` in the repo. You discuss changes to it beforehand, because it determines everything else. Current direction (proposal, mockup row "Design unslop (heydamir)"): product a desktop Orchtopus that runs several Claude Code sessions per project and stops at the gates; character attentive, precise, calm under load; world a signal box on the night shift with cool graphite surfaces and color only as a signal; highlights the decision card above the session and the gates as a signal line with lamps; signature the round signal lamp as the only status mark. The signal colors from F53 still apply. In the workflow, the skill is part of the review council: for changes to UI files, a reviewer checks the skill's checklist before the PR draft is created. For UI texts, the text skill of the same name by theclaymethod can also be used. It only changes wording.

**Favorites from the bolder variants.** Of the six variants on the mockup page (row "Bolder twists on the design-unslop base"), three were liked and are candidates as selectable design variants: **Signal Bloom** (the workspace is lit in the color of what is waiting for you; glowing lamps, decision card made of glass), **HUD Brackets** (instrument look with measuring grid, beveled corners, segmented progress, cyan as the accent, Space Grotesk) and **Prism Glass** (frosted-glass panels over a strong background of violet, blue and pink). Less in focus: Aurora Rail, Ember, Spectrum Lanes. The base "signal box on the night shift" stays the calm default.

**Swappable interface (E27, F55, F56).** The app is built so that a different look takes little effort, even when Claude makes the change:

- **Design tokens as the only source.** Components use only semantic tokens (for example `surface.page`, `surface.card`, `text.secondary`, `signal.permission`, `radius.card`, `font.ui`), never fixed colors, spacings or fonts. Implemented as CSS variables.
- **Theme = one module.** Each theme is in `themes/<name>/` with `tokens.json` for light and dark, optionally `effects.css` for backgrounds, glass, glow or corner shapes, and a preview. The app finds themes in the folder by itself. A new theme needs no change to components.
- **Fixed meaning of the signal colors.** A theme may adjust hue and lightness of the signal colors, but not their meaning (F53). The text labels always stay.
- **Effects can be switched off.** Glass, glow and animated backgrounds are part of the theme. They are simplified automatically with "Reduce motion" (Windows setting) and on weak machines. Terminal and decision cards stay nearly opaque in every theme.
- **Check when adding.** A new theme goes through an automatic contrast check (WCAG AA for text, signal colors distinguishable) and the checklist of the unslop skill (E26). Deviations that a theme makes on purpose are in its description.
- **Extensible with Claude.** A skill or a guide in the repo describes how to create a new theme from a description or a mockup: fill in tokens, add effects, run checks, render preview screens.
- **Settings › Appearance.** Mode Light, Dark or like Windows. Choice of the design variant with a small preview. The change applies at once without a restart. Initial scope: Stellwerk (default), Signal Bloom, HUD Brackets, Prism Glass.
- **Interplay with F48.** Themes determine the look, and the layout grid of the modular panels determines the arrangement. The two are separate so that you can change one without touching the other.

**Project wiki (E28, F57, F58).** For every project that is worked on in Orchtopus, Orchtopus creates a wiki: an understandable but sufficiently deep summary of the current state, meant for you to read.

- **Stored outside the repo.** One single HTML file per project, for example under `%APPDATA%\Orchtopus\wikis\<project>\index.html` (folder can be changed in the settings, for example to OneDrive). Everything needed is in the file, and it works without internet. Earlier states stay next to it as versions.
- **Altitude levels.** You should be able to move at different depths: from the overview (what the project does, how it is roughly built), through explanations (how the parts work together), to technical details (modules, interfaces, data models, references to files). Chapters and subchapters can each be expanded, so you can go deeper at any point without the page looking overloaded. A full view with all levels together is mandatory, so that search and table of contents work across everything and you do not have to search each level separately. How the depths are implemented is up to the implementation. One idea is a switch at the top that collapses content below the chosen depth instead of removing it.
- **Navigation.** Every wiki page always has a chapter menu on the right (chapters and subchapters, current position marked, stays visible while scrolling) and a search bar above it. The search runs across all levels, also across collapsed content, and jumps to the hit.
- **Diagrams and examples.** Architecture, flows, data flows and key figures are visualized. For diagrams, graphics and visualizations, the agent uses specialized skills. It decides during implementation which tools and formats it uses. Design follows the unslop skill (E26). Every chapter has at least one concrete example, for example a request with its response, or a flow on a real record from the test data.
- **Language.** Texts follow the text style from E32: about 80 % ASD-STE100 (short sentences, one statement per sentence, active voice, same terms for same things) and clearly laid out following the rules of the i-have-adhd skill (most important first, numbered steps, no filler paragraphs). Being easy to read is more important than the rule.
- **Only facts from the code.** The wiki describes what is in the repo, not what is planned. Every technical statement carries a reference to file and commit. Before publishing, a second agent checks the statements against the code. What it cannot confirm is dropped or marked as open. The state (branch, commit, date) is at the top.
- **Automatically up to date.** The trigger is a merge to the main branch (develop or main, by project rule). Optionally also a push to feature branches as a separate preview. Orchtopus detects the changed files, maps them to the chapters and regenerates only those. Several merges in quick succession are combined. The run happens in the background with a Claude session without write access to the repo. Its usage counts toward the Max quota and is visible in the settings (for example "at most once per hour" or "only at night").
- **Open from Orchtopus.** Button "Wiki" in the project header and in the project tree opens its own Orchtopus window. "Open in browser" is the alternative. From the wiki, links lead back to the file in VS Code.
- **First wiki.** When you add a project, Orchtopus suggests the chapter structure (from README, folders and dependencies). You confirm or change it, then the wiki is generated once in full.

**Investigate instead of build (E29, F59).** For situations where it is not yet clear what should be improved, there is the type *Investigate* when you create a session, next to Feature and Bugfix. Checked: its own mode with its own interface is not worth it, because terminal, plan, advisor and inbox stay the same. A normal feature session does not fit either, because its gates (TDD, review council, PR) target code changes and the session could otherwise start too early to change code. The session type therefore changes the following:

- **Question instead of feature.** At the start there is an investigation question, for example "Where is the image processing slow?" or "Which parts are poorly tested?". A short brainstorming sharpens it.
- **Investigation plan instead of implementation plan.** The plan lists questions, methods (read code, profiler, test coverage, logs, dependencies) and when the investigation is done. As usual, you can revise it in the plan editor with the advisor and extend it during the investigation.
- **Read only.** The session may read code, run tests and measurements, and write throwaway scripts in its own folder, but it must not change files in the project and must not push anything. Experiments that do need a change run in their own worktree, which is discarded afterwards.
- **Findings report as the result.** Instead of a PR, a report is created: findings with evidence (file, measured value), estimated benefit and effort, sorted by priority. It is rendered in the session view and goes into the wiki under "Open findings".
- **Handoff.** Each finding has a button "Start as feature session" or "Start as bugfix session". The new session starts with the finding as context in the brainstorming.
- **Gates.** Question confirmed (you), plan confirmed (you), report reviewed (a reviewer checks whether every finding is backed by evidence), report approved (you).

**GitHub and GitLab in Orchtopus (E30, F60).** Orchtopus talks to the matching provider per project through its CLI: `gh` for GitHub, `glab` for GitLab. Both use the existing login. Orchtopus does not store its own tokens. The provider layer is a common interface (create PR/MR, status, pipeline, reviews, comments), so the interface does not need to know which provider is behind it. The PR path from E24 applies to both: on GitLab, Orchtopus creates a merge request instead of a PR after your approval.

- **Pipeline.** Status and failed jobs are polled regularly (GitLab: `glab ci status -F json`, `glab ci view`; GitHub: `gh pr checks`, `gh run view --log-failed`). When a pipeline of your PR/MR fails, an inbox entry appears (red, "Pipeline failed") with job name and log excerpt, also on pad and watch. The button "Give to session" hands log and context to the session that built the branch, through the agreed handoff path (F49).
- **Reviews and comments.** New reviews, approvals and discussions from colleagues are shown in the PRs view per PR/MR (GitLab: `glab mr view --comments`, `glab mr note list --state unresolved`; GitHub: `gh pr view --comments`, `gh pr status`). Open discussions appear as an inbox entry "Review comment". Here too: draft the reply with the advisor, or give the comment as a task to the session. Nothing is sent until you click.
- **Review requests to you.** List of the PRs/MRs where you are entered as reviewer (GitLab: `glab mr list --reviewer=@me`; GitHub: `gh pr status`). From there you can start the review with the agents from F45.
- **Stay clear.** The inbox shows only things that concern you (your PRs/MRs, review requests to you). Everything else is only in the PRs view. The polling interval and which events go to pad and watch can be chosen in the settings.
- **To check before implementation:** exact JSON fields of the CLI versions in use, behavior with self-hosted GitLab instances, and rate limits when polling.

**Rendered chats in the panels (F61).** The main session stays the real terminal. All chats in panels (side chat, advisor in plan, diff and review detail, review chat), however, are rendered views: Markdown with headings, lists, tables and links, code with syntax colors and a copy button, diagrams, collapsible tool calls. Answers appear smoothly while they are being written. Input can contain Markdown, and files and snippets can be attached by drag and drop.

**Questions, course corrections, new instructions (F63).** In a session, the main session coordinates the work and hands individual tasks to subagents. It is usually busy while doing so. So that you do not disturb it unnecessarily, there are three clearly separate paths:

- **Question** ("Why is it doing this?") goes to the side chat. It reads along with the state of the session but has its own context. The session is not interrupted and its context is not burdened. A new history per topic.
- **Course correction** ("Use dayjs instead") goes through the input of the session, or from the side chat with "Give to session" (F49). The default is delivery after the current task. A note shows "will be delivered after task 12", next to it "Interrupt now" for emergencies. When you interrupt at once, Orchtopus warns if running subagents would be aborted.
- **New, independent instruction** becomes a new session (Feature, Bugfix, Investigate), so that contexts do not mix.

**Keep context under control (E31, F62).** Basic rules following Anthropic's recommendations: one session per task, hand extensive work to subagents, compact early yourself with a hint instead of waiting for automatic compacting, and use a written handoff for a clean restart. Orchtopus implements this as follows:

- **Measure.** Each session reports its fill level to Orchtopus through the status line of Claude Code (the field `context_window.used_percentage`). Shown as a bar in the session overview and in the sidebar.
- **Thresholds instead of fixed percentages.** Default: notice from about 40 %, suggestion from about 60 %, urgent from about 75 %, so well before the built-in compacting starts. The values can be changed per model in the settings. Orchtopus does not rely on the environment variable for the auto-compact threshold, because it did not work reliably in several versions.
- **Act only at rest points.** Switching or compacting never happens in the middle of a tool call, but when a task is finished, a gate is passed or the session is idle. If a rest point is far away and it becomes urgent, Orchtopus asks whether it should finish the current task first or switch before that.
- **Two ways, without loss of information.**
  - *Fresh session with handoff* (preferred at task or gate boundaries): The session writes `.orchtopus/handoff.md` in the worktree (task, plan progress, next step, open decisions, pitfalls, important files). Then Orchtopus starts a new session in the same worktree with spec, plan and handoff. The lasting state is on disk anyway (plan with ticks, spec, Git), so little is lost. In Orchtopus it stays the same session tile. The old history stays readable.
  - *Targeted compacting* (when a restart in the middle of a task would cost more): Orchtopus sends `/compact` with a hint of what must be kept. Before that, a PreCompact hook saves the state to a file. After that, a SessionStart hook with the matcher for compacting loads the important content back into the context.
- **Orientation check.** After every switch or compacting, the session briefly answers: Which task, which next step, which open decisions? Orchtopus compares this with the handoff and reloads if it differs. The result is visible in the session overview.
- **Automation selectable.** In the settings: "ask" (default, notice in the inbox as info, not in the permission color; one click on "Yes" does the rest itself), "automatic" or "off". Pad and watch show only the urgent level.
- **Keep subagent reports short.** Subagents write details to files and give the main session only a short summary, because collected reports would otherwise fill the context.
- **To check before implementation:** how reliably the reported fill level matches the actual compacting point, and whether there is by now an official way to trigger compacting from a hook. Until then, Orchtopus sends the command through the terminal.

**Text style (E32, F65).** Everything Claude writes to you in Orchtopus follows a common text style by default: advisor, side chat, main session, findings reports, PR descriptions and wiki.

- **About 80 % ASD-STE100** (Simplified Technical English): short sentences (instructions up to about 20 words, descriptions up to about 25), one statement per sentence, active instead of passive, one term per thing and always the same one, steps as a numbered list. Not 100 %: the restricted dictionary and the strict word rules do not apply, so that texts stay natural. For German texts, the same principles apply in spirit.
- **Rules of the skill [i-have-adhd](https://github.com/ayghri/i-have-adhd)** (license MIT): The first line is the result or the next action, steps are numbered, the current state is briefly repeated, no opening or closing phrases.
- **Implementation.** The style is its own building block (skill or style file) in Orchtopus and is passed to every session, every advisor and the wiki generator. The i-have-adhd skill can be set up so that it is loaded automatically in every session. Orchtopus uses this way or includes the rules directly in its style file.
- **Configurable.** In the settings it can be switched on and off per place (for example on in the wiki, off in PR descriptions) and has a level "concise / normal / detailed". Code, commands and error messages are never reworded.

**Easy to develop further and update (E33, F66).** Orchtopus is built so that a small change also takes little effort.

- **Content as files, not as code.** Prompts, skills, session types and their gates, wiki template and chapter structure, text style, themes (E27), start profile templates and notification rules are files in their own folders. The app reads them at start and reloads them when they change, without a restart. If you want to improve the wiki structure, you change the template, not the app.
- **Building blocks with version.** Each building block has a version number and a short description of what it needs. Updates can replace individual building blocks. The app itself is only rebuilt when code changes.
- **Follow up on the effects of an update automatically.** When the wiki template changes, Orchtopus regenerates the wikis in the background (same rules as F58). When a data format changes, a migration runs for settings and session data. A backup is made beforehand.
- **Way back.** Every building block version is kept, and an update can be undone with one click.
- **App updates.** The app itself updates through the update mechanism of the chosen framework (Electron or Tauri), with a notice instead of force. Running sessions are paused cleanly beforehand and attached again afterwards.
- **Local customizations stay.** Your own changes to building blocks are stored separately from the shipped ones and are not overwritten by an update. Orchtopus shows conflicts.
- **Develop Orchtopus with Orchtopus.** The Orchtopus repo is itself a project in Orchtopus, with wiki and gates. Tests cover the building blocks one by one, so that a change to one does not silently break another.

**Public repo, no project data (E36).** The Orchtopus repo becomes public. Therefore: examples, mockups, tests and docs use only generic names (for example `acme-app`, `report-export`, `upload-fix`). Everything project-related is outside the repo in the user folder (for example `%APPDATA%\Orchtopus\`): project configuration, wikis, session histories, learning notes, usage data. Before every push to the public repo, an agent additionally checks the changes for project-related names and secrets (double check, no CI pipeline of its own).

**Agent adapter instead of a fixed bridge mod (E35).** The bridge mod stays an idea for later. Orchtopus talks to Claude Code through an adapter layer. The interface knows only its API: start session, attach, send input, read status and events, answer permission, read context fill level and limits. First adapter: terminal (PTY) for input and output, official hooks of Claude Code (for example for notification, stop and permission request) that report the events to the local API, and the status line for fill level and limits. Permissions: The hook reports the request to Orchtopus and waits for your decision within its time limit. If none comes, the session falls back to the normal prompt in the terminal. Later adapters (bridge mod, other agent CLIs) implement the same interface. To check before implementation: which hooks the Claude Code version in use offers, and how long a permission hook may wait.

**Crash and restart (F75).** Goal: after a crash or a Windows restart, continue with one click, without great effort in the implementation.

- **State on disk.** A local store (for example SQLite) holds projects, sessions, gates, inbox and settings. Every decision of yours (permission, plan Go, PR approval) is logged first and then executed. Actions are built so that a repetition does nothing twice.
- **Sessions outlive Orchtopus.** Sessions run as their own Claude Code processes or background sessions. At start, Orchtopus compares saved session IDs with the running ones and attaches again. Ended sessions can be continued in the same worktree with history (Resume) or started fresh with a handoff (F62).
- **Save drafts automatically.** Plan changes, PR texts and started inputs are saved every few seconds.
- **Recovery view.** After an unexpected end, Orchtopus shows at start what was running, what was waiting and what it attached again. Open permissions appear again. Optionally, Orchtopus starts with Windows.
- **Deliberately not:** no mirroring to other machines, no transactions across Git.

**Usage at a glance (F67).** Settings › Usage shows the Max limits (5-hour and weekly window with reset time, from the status line), the usage per session and role as far as Claude Code provides it, and the background jobs. Thresholds are adjustable: from, for example, 70 % background jobs (wiki, investigations) pause, from, for example, 90 % Orchtopus asks before new sessions. When the limit is reached, sessions pause at the next rest point. After the reset, Orchtopus reports in and continues on request.

**Model and effort per role (F68).** Settings › Models lists the roles with model and effort: main session/implementation, brainstorming and planning, each reviewer in the review council, advisor and side chat, Investigate, wiki generation, wiki check, summaries. Defaults are sensibly preset (strong model for planning and implementation, cheaper one for checks and summaries). They can be overridden per project and when starting a session. Where Claude Code does not allow model or effort per agent, the value of the session applies.

**Resources, realistic (F69).**

- **Active sessions:** no fixed upper limit. Orchtopus shows count, quota and machine load. An upper limit can optionally be set in the settings (off by default).
- **Test locally:** any number of test environments at the same time. Ports are assigned per worktree (base port from the start profile plus a fixed offset per worktree) and passed as environment variables. Ports that are in use are detected and skipped. Running environments are in a list with a stop button.
- **Storage:** storage need per worktree in the project view. Notice when free space is low. Cleanup after the merge is offered (already planned).
- **Background jobs** (wiki, investigations) run as soon as they are due. The only brake is the quota: from the set threshold (F67) they are deferred and continue after the reset.
- **Principle:** no limits that are not necessary. Orchtopus shows load and usage and warns instead of limiting as a precaution. No CPU throttling, no distribution to other machines.

**Protect secrets (F70).** Can be switched on and off globally and per project, nothing is hard-coded: The rules are a file (building block, E33) and can be edited in the settings. Categories that can be switched individually: `.env` files and other file patterns, known key formats, values with high randomness, own terms and paths. Found values are masked in wiki, advisor answers, PR texts and logs. Before a PR draft with a suspicion, there is a warning.

**Project onboarding (F71).** "Add project" leads in a few steps to a ready-to-start project:

1. **Choose folder.** Orchtopus checks the Git repo, remote, default branch and whether `gh` or `glab` is logged in.
2. **Detect, without Claude.** Package manager and scripts, commands for tests, lint and types, CI configuration, branch patterns from the last branches, commit style from the log, CODEOWNERS, existing `CLAUDE.md`/`AGENTS.md` and `.claude` settings, installed skills, monorepo structure, ports from dev scripts and `.env.example` (names only).
3. **Proposal from Claude.** From the findings, a proposal is created in blocks: gates, branch and PR rules, start profiles, composition of the review council, secret rules, chapter structure of the wiki. Each block can be accepted or changed individually.
4. **Save.** By default outside the repo in the user folder (E36). Optionally also as `.orchtopus/project.json` in the project repo, if the team should share it.
5. **Trial run.** The gate commands run once on the default branch. Errors and run times are shown before the first session starts.
6. **Optional.** Install recommended skills (for example superpowers, unslop, i-have-adhd) for the project or for you. Schedule the first wiki as soon as the quota allows it.

"Re-read project" repeats steps 2–3 later and shows only the differences.

**Keep learnings (F72).** At every merge of a PR/MR, at the end of an investigation and after a session with fix rounds, Orchtopus evaluates what happened: fix rounds and their causes, findings of the review council, review comments from colleagues, your change requests, rejected commands, repeated corrections in chat. From this come suggestions with evidence, for example "Tests for month end always with leap year" or "Always allow `npm run build` in this project". They appear directly at the respective event as a calm inbox entry and in the review detail of the merged PR/MR. Targets: the project's `CLAUDE.md` (through a normal PR per E24), project rules and permission rules in Orchtopus, checklists of the reviewers, section "Pitfalls" in the wiki. You accept, change, defer or discard.

- **Deferred or discarded does not mean forever.** Orchtopus remembers the suggestion. If the same pattern occurs again, it comes back with the new evidence ("for the 3rd time since discarding"). Only with "Never suggest again" is it off for good.
- **List of all suggestions** in the project settings: accepted, open, deferred, discarded. Each one can still be adopted later.
- **Storage selectable:** A switch decides whether project rules end up in the repo (`CLAUDE.md`) or only locally in the user folder.

**Keyboard (F73).** All shortcuts are in a keymap file and can be changed in Settings › Keyboard, with conflict display. Proposal for the assignment:

- **In the app:** `Ctrl+K` command palette (every action is there and can be bound), `1`–`5` views, `Ctrl+1`–`Ctrl+9` switch session, `I` inbox, `Ctrl+Ö` terminal, `Esc` back, `?` overview of all shortcuts.
- **Permissions by keyboard:** only when the permission card has focus: `Enter` allow once, `D` deny, `B` ask advisor. Dangerous commands never by key, only by holding in the app.
- **Global (optional, off by default):** `Ctrl+Alt+L` brings Orchtopus to the front, `Ctrl+Alt+Space` opens a small input field: question to the advisor, new instruction or note.

**Stacked PRs/MRs (F74).** For large changes and for "Split PR":

- **Structure.** A stack is an ordered chain of branches: `develop` ← `feat/x-1` ← `feat/x-2` ← `feat/x-3`. Each PR/MR targets the branch below it. A plan can already provide PR boundaries. Otherwise the stack is created through "Split PR".
- **Create.** The advisor proposes the cut, and the session distributes the commits to the branches (agreed steps, F49). After your approval, Orchtopus creates the PRs/MRs from bottom to top. Each description names position and dependency ("2 of 3, builds on !12").
- **Display.** In review detail and in the PRs view, the stack appears as a vertical line. Each level has its own gates, pipeline and reviews.
- **Update.** When a lower level changes (for example after review comments), the session updates the upper branches in order (for example with `git rebase --update-refs`) and pushes with `--force-with-lease`, but only to its own stack branches and after a confirmation for each update. The session resolves conflicts with an agreed plan.
- **After the merge.** When the lowest level is merged, Orchtopus moves the next PR/MR to the target branch (GitHub: change base, GitLab: change target branch) and has it rebased. This is especially necessary with squash merges, because the commits look different afterwards.
- **Notes instead of limits.** No fixed depth. From four levels, Orchtopus points out that reviews and updating become more costly. Also a note when a lower level stays open for a long time. External stack tools are to be evaluated. First the own, lean way.

## Keep the Git state up to date

The displayed Git state must always be correct without you triggering anything. Otherwise overlaps, merge order and gates are worthless (F35).

- **Local, instantly:** A file watcher per worktree updates changed files, diff numbers and the tree of changes on every change (throttled, for example at most every 2 s). Also after every `Edit`/`Write`/`Bash` tool call that the bridge mod reports.
- **Remote, regularly:** `git fetch` in the background (default every 5 minutes, adjustable) and when a project is opened. From this: branch ahead/behind main, PR status and CI checks through `gh`.
- **Base has moved:** If main has moved on since the branch was cut, the card shows "behind main" and suggests a rebase. For overlaps with the new main state, the warning is recalculated.
- **After merge:** merged branches are marked as done. Worktree and session can be cleaned up with one click (never deleted automatically).
- **Read only:** The app itself runs no writing Git commands, except after your click (merge, cleanup). Rebase and commits are done by the session.

## Pets (just for fun)

In the bar above the input of the main session, a small pixel figure can walk on the right and react to the state (F34, E22).

- **Behavior:** working → walks or types; waiting for you → waves; gates red → sad; gates green / PR ready → dances; idle → sleeps.
- **Figures:** shipped own figures (for example cat, small robot, slime, fox) and own sprite sheets (PNG, rows of images per state) that you can load. Do not ship logos or mascots of Anthropic or other brands.
- **Technique:** The bar belongs to the bridge mod (render site above the prompt). In the terminal it draws pixels with the `Raster` element, the animation through redrawing (at most 10 frames per second) or a `Client` element. Alternatively, the app draws the figure natively above the terminal.
- **Settings:** on/off, figure, size, "Reduce animations" (then only a still image per state).

**Additional behavior (from the mockups Pets · 1 and 2):**

- Speed by activity: The figure runs faster the more tool calls per minute (idea from RunCat, where the cat runs by CPU load).
- Speech bubble with the reason when the session needs you. A click on the figure opens the inbox.
- "Ready for review": dance briefly (5 s), then sit contentedly, so that it does not annoy.
- Name per figure. Optionally level and experience points for finished tasks (off by default).
- Optionally also on the pad display and on board cards.
- Own figure: PNG strip with one row per state, 14–32 px high, up to 8 frames per row, 6–10 frames per second, plus a small JSON file with name and speed.

**Inspirations:** [VS Code Pets](https://github.com/tonybaloney/vscode-pets) (figures, names, several pets, themes), [RunCat](https://apps.apple.com/us/app/id1429033973) (speed by load, own image strips), [Claude Code Mascot](https://github.com/TeXmeijin/claude-code-mascot-statusline) and [buddy](https://github.com/AlexFloyd13/buddy) (figures in the status line, reaction to hook events, level), [claudepet](https://github.com/qaz61328/claudepet) (speech bubbles for permissions).

## Functional requirements

Priority: **Must** = MVP, **Should** = second stage, **Could** = later. "Source" says where the data comes from.

| ID | Requirement | Prio | Source / implementation | Acceptance |
| --- | --- | --- | --- | --- |
| F01 | Open a project via folder picker or the "recently opened" list | Must | App, `.orchtopus/project.json` | Pick a folder → the project's board appears |
| F02 | Restore: attach running background sessions, show finished ones, restore tabs, inbox, notes and window layout | Must | `claude agents --json`, app database | Kill the app hard, restart → same state |
| F03 | "Since you were away": short summary per session since the last time you opened it | Should | App event log, `$.model.complete` (small model) | 1–2 sentences per session, changes only |
| F04 | New session from a template (project, worktree, agent, permission mode, model, start prompt) | Must | `git worktree add`, `claude --bg --name …` | Session appears on the board under "Running" |
| F05 | Board with columns Needs you, Review, Running, Start, collapsed Idle/Done | Must | Bridge mod, hooks | A state change appears in ≤ 2 s |
| F06 | Card shows: name, branch, state with reason, now/next, agent counter, gate status, overlap | Must | Bridge mod (tasks, `$.agent.list()`), gate runner, Git | All fields filled or deliberately empty |
| F07 | Inbox across all projects, usable by keyboard and pad | Must | App | Every "needs you" case appears exactly once |
| F08 | Permissions from the inbox and pad with a 60 s fallback to the terminal prompt | Must | Bridge mod `tool.check` (E7) | Allow/Deny takes effect; without an answer the terminal prompt appears |
| F09 | Send plan go and answers to a session | Must | `$.prompt.submit({ text, asUser: true })` or `$.session.send` | Session continues after "Go" |
| F10 | Session view with embedded terminal (ConPTY + xterm.js), attached via `claude attach` | Must | App | Terminal behaves like a normal terminal, mod elements visible |
| F11 | Right panel for the active session only: summary, tasks, agent tree, gates, send instruction | Must | Bridge mod | Switching the session switches the panel |
| F12 | Agent tree: main agent and subagents with role, status, runtime, last tool | Should | `$.agent.list()`, `SubagentStart/Stop`, `tool.call` | Failed or stalled subagents land in the inbox |
| F13 | Stalled detection: working, but no event for X min (default 10) | Must | App timer over event timestamps | Inbox entry with status request / Open / Cancel |
| F14 | Overlap warning between worktrees of the same repo, with a merge-order suggestion | Should | `git diff --name-only` per branch against base | Same file in two branches → warning on both cards |
| F15 | Run and show gates automatically (see section Gates) | Must | Gate runner (app, or mod on `turn.complete`) | A red gate blocks and triggers a fix round |
| F16 | Review council (spec fidelity, quality, security when relevant, leanness, test quality, synthesis) | Should | Subagent definitions in the project | Findings deduplicated, sorted by severity |
| F17 | Review view with tree of changed files, diff, create PR, merge (human gate) | Must | Git, `gh` | Merge only with all Must gates green |
| F18 | "Start" backlog from unstarted Superpowers plans (issues are not used for now; integration optional later) | Should | `gh issue list`, `docs/superpowers/plans/` | A click starts a session with the matching template |
| F19 | Notification rules per project (pad, toast, webhook to phone) | Should | `project.json` | The rule fires on the matching event |
| F20 | Pad: display with sessions, keys for Allow/Deny/Next/Open/New/Status | Idea only (E34) | USB serial, local API | A key press works like a click in the app |
| F21 | Stream Deck as an alternative to the pad | Could | Stream Deck plugin against the local API | – |
| F22 | CI watcher: on red CI or a review comment, suggest a fix session | Could | `gh`, polling | Inbox entry with "Start fix" |
| F23 | Several projects open at once, switch via project menu | Should | App | Inbox stays cross-project |
| F24 | Notes per session (your own keywords, persisted) | Could | App database | – |
| F25 | Settings global and per project; each setting shows its origin (Global/Project) and can be reset | Must | %APPDATA%\\Orchtopus\\defaults.json, .orchtopus/project.json | A project value overrides only that field |
| F26 | Enforce workflow (default on): active steps cannot be skipped; small tasks may use short-form spec and plan | Must | CLAUDE.md section + bridge mod (tool.call blocks, follow-up prompts on turn.complete) | gh pr create is blocked while a Must gate is red |
| F27 | Configurable git rules: branch pattern, commit style, merge type, PR target, block push to main and force push, free-text rules | Must | Settings → CLAUDE.md + bridge mod blocks | git push --force is rejected with a reason |
| F28 | Toggle gates individually with command, including Test locally only when affected | Must | project.json | A disabled gate appears grey, not red |
| F29 | Notifications as a matrix event × channel (pad, toast, phone) with quiet hours | Should | project.json / defaults.json | Quiet hours suppress all channels except the allowed ones |
| F30 | Project instructions as free text, written into a managed section of CLAUDE.md with preview | Must | Markers \<!-- orchtopus:start/end --> | Text outside the markers stays unchanged |
| F31 | Side chat per session: reads history, plan and optionally diff; no tools; not saved; Clear; "Copy to instruction" only fills the instruction field | Must | $.model.fork, history only in the app's memory | The session shows no trace of the side chat |
| F32 | Advise on gates, findings and overlaps: side chat prefilled with the finding or both diffs; actions only on click | Should | like F31 plus diff context | "Queue rebase instruction" creates the instruction only after a click |
| F33 | Diff view: tree of changed files, compare against main or another branch, buttons "Worktree in VS Code" (code \<path>) and "Diff in VS Code" (code --diff) | Must | git diff, VS Code CLI | A click opens VS Code in the right worktree |
| F34 | Pets: pixel figure on the right in the bar above the input, reacts to the state; custom sprite sheets loadable | Could | Bridge mod (grid/client in the bar) or app overlay | The figure changes animation on a state change in ≤ 2 s; can be turned off |
| F35 | Git state always current: file watcher per worktree, background fetch, ahead/behind main, PR and CI status, hint when main has moved on | Must | File watcher, git, gh, bridge mod events | A change in the worktree appears in ≤ 2 s; a new commit on main appears after the next fetch at the latest |
| F36 | Project terminal: panel below the main session with several tabs, selectable shell (PowerShell 7, Git Bash, cmd, WSL), start in the project root or in the session's worktree, resizable height, split, maximize, Ctrl+Ö on/off. Extra button "Open in Windows Terminal". Tabs with folder and shell are restored when the project is opened. | Must | ConPTY + xterm.js (as for claude), app database for the tab list | A new terminal starts in ≤ 1 s in the right folder; keystrokes go only to the focused terminal, never to the session; after an app restart the tabs are back |
| F37 | Buttons "Explorer", "VS Code" and "Windows Terminal" in the header of the session view and in the context menu of project and worktree in the sidebar. Each opens its own window (not embedded in the app) in the project root or in the chosen worktree. | Must | explorer.exe \<path>, code \<path>, wt.exe -d \<path> (Electron: shell.openPath for Explorer) | One click opens the window in the right folder; if VS Code or Windows Terminal is missing, the button is greyed out with a hint |
| F38 | Spec/plan view: editor on the file in the worktree, chat with mode Question/Instruction, suggestions can be applied, review bar after writing-plans, Plan go / Spec fits at the top | Must | File access in the worktree, $.model.fork, $.prompt.submit | A change in the editor lands in the file; the session re-reads it on Go |
| F39 | Advisor chat with context in diff, plan/spec, review detail and PR detail | Should | $.model.fork or own model call without tools | The answer names the context of the view; nothing is written into a session |
| F40 | Close detail views and go back (history, Esc) | Must | App router | Esc always returns to the previous view |
| F41 | Request changes with your own text; reset gates from lint and run them again | Must | Gate runner, $.prompt.submit | After your request, review, git check, PR and CI are open and run again |
| F42 | Review detail: tasks, commits, gates, findings, git check, test locally, PR draft, chat | Must | git log, app DB | All information on one state on one page |
| F43 | PR draft from Claude, approval by you, then gh pr create; never merge itself; branch rules per project | Must | gh, project.json git rules | Without approval no PR is created; target branch matches the rule |
| F44 | Git and PR reviewer (branch, commits, CI config, scope, split suggestion), to be evaluated | Should | Own agent in .claude/agents/ | Findings appear in the review detail |
| F45 | List other people's PRs/MRs and write a review draft with agents that you send, to be evaluated | Could | gh/glab, agents | Nothing is posted to GitHub without a click |
| F46 | Test locally with start profiles, also across several repos | Should | project.json run profiles, ConPTY | Start in ≤ 1 click; second repo on a matching branch |
| F47 | Movable dividers, sizes per project, scroll positions are kept | Must | App UI | New output does not move any other panel |
| F48 | Modular panels, freely arrangeable later | Could | Layout grid | The architecture allows it without a rebuild |
| F55 | Appearance in the settings: Light, Dark or like Windows; choice between several design variants | Must | Settings › Appearance | The change takes effect immediately without a restart and stays saved; every variant exists in light and dark |
| F56 | Themes as modules: add or adjust a theme without changing components | Must | Design tokens, theme folder | A new theme consists of one token file (plus optional background/effects), appears automatically in the choice and passes the contrast and unslop check |
| F57 | Project wiki as HTML with altitude levels, diagrams and examples; open it from Orchtopus | Must | Wiki generator, wiki window | Different depths can be expanded and there is an overall view with search across everything; every technical statement points to a file and commit; opens by button in its own window or in the browser |
| F58 | Keep the wiki up to date automatically (after merge, optionally after push) | Must | Background job | After a merge to the main branch the wiki is updated within an hour; only affected chapters are regenerated; the state (commit, date) is shown at the top |
| F59 | Session type "Investigate" with findings report and handoff to new sessions | Should | New session, inbox | Code stays unchanged; the result is a report with prioritized findings; from each finding you can start a feature or bugfix session |
| F60 | GitHub/GitLab in Orchtopus: pipeline status and error log, reviews and comments, review requests to you | Must | PRs view, inbox, pad, watch | A failed pipeline appears as an inbox entry with the failed job and a log excerpt; new reviews and comments are visible and can be handed to the session |
| F61 | Chats in panels (side chat, advisor, plan/review chat) are shown rendered, not as a mini terminal | Must | All chat panels | Headings, lists, tables, links, code with syntax colors and copy button, diagrams; answers appear smoothly as they are produced |
| F62 | Context indicator per session and fresh session or targeted compaction without information loss | Must | Session overview, inbox, settings | Fill level visible; hint from a threshold; execution only at rest points; after the switch the session knows the task, next step and open decisions |
| F63 | Three input paths: question in the side chat, course correction to the session (after the current task or immediately), new instruction as a new session | Must | Session view, side chat | Input to the session shows "will be delivered after task N" and offers "Interrupt now"; questions in the side chat do not interrupt the session |
| F64 | Wiki navigation: chapter menu always on the right, search bar always visible | Must | Wiki | The menu shows the current position and stays visible while scrolling; search also finds collapsed content |
| F65 | Text style (E32) as the default in advisor, side chat, sessions and wiki; adjustable in the settings | Must | All texts from Claude | Answers start with the result or the next action; style can be turned on or off per place |
| F66 | Simple updates of Orchtopus: update building blocks individually, migrate data, update affected wikis automatically | Must | Architecture, update mechanism | A changed wiki template is active after the update without touching sessions, settings or other building blocks; rollback to the previous version is possible |
| F67 | Usage view: Max limits (5 hours, week), consumption per session and role, behavior near the limit | Must | Settings › Usage | Display with reset time; background jobs pause from a threshold; when the limit is reached, sessions pause at the next rest point and continue after the reset |
| F68 | Model and effort configurable per role (global, per project, at session start) | Must | Settings › Models | Each role shows model and effort; the change applies to new sessions and agents |
| F69 | Resources: no fixed upper limit for sessions and test environments, port allocation for start profiles, memory hints | Must | Session start, Test locally | Two worktrees can run locally at the same time without a port conflict; load and consumption are visible |
| F70 | Secret filter, switchable globally and per project, rules as a file | Must | Settings › Privacy | Suspicious values are masked in wiki, advisor, PR text and logs; warning before the PR draft |
| F71 | Project onboarding with automatic detection and confirmation | Must | Add project | A new project is ready to start after a few confirmations; gate commands have been run successfully once |
| F72 | Capture learnings: suggestions for project rules after finished work | Should | Inbox, project settings | Suggestions with evidence at every merge; nothing without confirmation; dismissed ones return on new evidence, except "Never again" |
| F73 | Configurable keyboard shortcuts, command palette, optional global hotkeys | Must | Settings › Keyboard | Every command palette action can be bound; conflicts are shown |
| F74 | Stacked PRs/MRs (stacks): create, keep up to date, and re-target after merge | Should | Split PR, review detail, PRs view | Stack visible as a path; a change at the bottom updates the upper branches; after a merge the next MR points to the target branch |
| F75 | Robust against crash and restart: state on disk, re-attach sessions, back up drafts automatically | Must | Local storage, start | After a crash or restart the start shows what was running and waiting; one click resumes; no decision is executed twice |

## Session states

A session has exactly one main state; "needs you" always has a reason. The order of the table is the sort order on the board.

| State | Reason (examples) | Detected by | Where it goes |
| --- | --- | --- | --- |
| needs you | Permission, plan go, question from Claude, gate red after 2 fix rounds, subagent failed | `tool.check` with decision "ask", `Notification` (`permission_prompt`, `agent_needs_input`, `elicitation_dialog`), Superpowers phase + turn end, gate runner | Inbox, pad, toast |
| probably stalled | working, but no event for X min | App timer over the last event timestamp | Inbox, pad |
| ready for review | Work done, gates green, PR open or ready | Superpowers completion, `Stop` without open tasks + changes in the worktree | Board column "Review", toast |
| running | Turn active or subagents active | `turn.start`, `tool.call`, `$.agent.list()` | Board "Running" |
| waiting for others | Task blocked by another task or merge | Task dependencies, merge order | Board "Running" with hint |
| idle | nothing open, no activity | `Stop` without open tasks, `Notification` `idle_prompt` | collapsed |
| done | merged or archived | Merge, `claude rm`/archive | collapsed, in history |

Rules:

- Several reasons at once: the most urgent counts (permission before plan go before question before red gate before stalled).
- "Stalled" is only a suspicion and never triggers a cancel automatically.
- The Superpowers phase (brainstorm, spec, plan, execute, review, finish) is shown in addition, but is not a state of its own.

## Permissions and security

A permission from the app or pad applies to exactly one tool call and always comes from your click or key press, never from text written by Claude or another session.

**Flow (E7)**

1. Claude wants to run a tool. The bridge mod hooks into `tool.check` and lets Claude Code decide normally first (`await next(e)`).
2. If the result is `allow` or `deny`, the mod returns it unchanged. Only on `ask` does it continue.
3. The mod reports the request to the app via `POST /approvals` (tool, input, session, worktree) and receives an ID.
4. The mod waits via repeated `GET /approvals/{id}/wait` (long poll, each up to about 25 s). This wait sits inside a mod API call and, according to the docs, does not count toward the hook time limit. In the terminal, `$.ui.status` shows "waiting for permission in Orchtopus".
5. You decide in the inbox or on the pad. The app answers the long poll with `allow` or `deny`.
6. Without a decision after 60 s, the mod returns the original `ask`: the normal prompt appears in the terminal. The inbox entry switches to "answer in the terminal".
7. Errors (app unreachable, time limit) also lead back to `ask` via a `.catch` handler, never to `allow`.

**Safeguards**

- The local API listens only on `127.0.0.1`, with a random token per installation. Bridge mod, hooks and pad driver read the token from a file in the user profile.
- The app accepts decisions only from its own interface and from the pad, not from session replies.
- Every permission is logged with time, session, tool and input.
- Permanent permissions are not granted in the app, but maintained as Claude Code permission rules (e.g. `Bash(npm test)`). The app can suggest a rule, but writes it to the settings only on click.
- Dangerous commands (e.g. `git push --force`, `rm -rf`, publish) get a red border in the inbox and no pad shortcut for "Allow", only "Open".
- Mods run without a sandbox. The own bridge mod lives in the project repo; third-party mods only after `claude plugin validate`.

**Plan go and questions** are not permissions: the app sends your answer as text into the session (`$.prompt.submit` with `asUser: true`).

## Gates and review council

Automatic gates block only when red and then trigger a fix round themselves (at most 2). Only after that does the case go to the inbox. There are exactly three human gates: Spec, Plan, Merge.

| # | Gate | Type | When | Blocks on | Tool (example acme-app) |
| --- | --- | --- | --- | --- | --- |
| G1 | Spec approved | Human | after brainstorming | – | Superpowers spec, plan go via inbox |
| G2 | Plan approved | Human | after plan | – | Superpowers plan |
| G3 | Test red first (TDD) | auto | per task | new code without a previously red test | Superpowers TDD, test run before implementation |
| G4 | Tests green | auto | per task and before PR | a test is red | `npm test` |
| G5 | Lint and types | auto | per task | errors | `npm run lint`, `tsc --noEmit` |
| G5a | Test locally | auto, when affected | before review council | smoke test red | Start the app locally and run a smoke test, e.g. npm run dev + Playwright; only when UI or API paths are affected (paths from the project instructions) |
| G6 | Fixed checks | auto | before review council | critical findings, diff over budget | `npm audit`, Semgrep, diff budget (e.g. 400 lines net) |
| G7 | Review council | auto | before PR | critical or medium open | see below |
| G8 | Overlap | Hint | before merge | does not block, suggests order | Git comparison of the branches |
| G9 | CI | auto | after PR | red | GitHub Actions, `gh pr checks` |
| G10 | Merge | Human | last | – | Merge button in "Review" |

**Review council (E11)**

1. **Spec fidelity** first, blocking: was what the spec asks for implemented, and nothing more?
2. **Specialists in parallel**, each with a narrow task:
   - Code quality: readability, error handling, naming, edge cases
   - Security: only when upload, auth, dependencies, configuration or external input are affected
   - Leanness: no bloated abstractions, no duplicates of existing helper functions, diff budget, dead code removed
   - Test quality: do tests check behavior instead of mocks, are edge cases covered
3. **Synthesis:** deduplicates, sorts by critical / medium / low, writes low items as a checklist into the PR text.

Rules: critical or medium → automatic fix round, then the council runs again for the affected specialists. Voting by several agents on the same question is optional, only for security on sensitive changes. The reviewers are normal subagent definitions in the project (`.claude/agents/`) and are therefore versionable.

**Where the gates run:** G3–G5 run inside the Superpowers steps. G6, G7 and G9 are started by the app (gate runner) on the switch to "ready for review". The app writes results to its database and shows them in the card, session panel and Review view.

## Persistence and restore

What belongs to the project and may be shared lives in the repo; what concerns only your workstation lives in the app database. This way everything survives closing the app, and a project behaves the same on a second machine.

| What | Where | Why there |
| --- | --- | --- |
| Gates, templates, review council, notification rules, thresholds | `.orchtopus/project.json` in the repo | versioned, the same for all worktrees |
| Reviewer and role definitions | `.claude/agents/*.md` in the repo | standard Claude Code format |
| Bridge mod | Plugin in the repo or in user scope | loads in every session, including background ones |
| Session IDs, session ↔ worktree mapping, names, notes | App database (SQLite under `%APPDATA%\Orchtopus`) | local, contains paths and IDs |
| Inbox entries, event log, gate results, permission log | App database | basis for "Since you were away" |
| Open tabs, view, window layout | App database | workstation state |
| API token | File in the user profile, readable only by the user | read by mod, hooks and pad |
| Conversation history of the sessions | Claude Code itself | not copied, only referenced by ID |
| Global defaults of all settings | %APPDATA%\\Orchtopus\\defaults.json | apply to every project that does not override a field |
| Managed CLAUDE.md section | CLAUDE.md in the repo, between orchtopus:start and orchtopus:end | Claude reads it automatically; the rest of the file stays yours |
| Side chat history | in memory only | deliberately volatile |

**Restore on open**

1. Read the project configuration, reconcile worktrees with `git worktree list`.
2. Read `claude agents --json --all` and reconcile with stored session IDs.
3. Attach running sessions, show finished ones as "ready" or "done" (if needed `claude --resume <id> --bg`).
4. Load events since the last close; reconstruct what the app missed via transcripts and Git.
5. Generate "Since you were away", rebuild the inbox, restore tabs and view.

**Example `.orchtopus/project.json`** (draft, fields may change during implementation):

```json
{
  "name": "acme-app",
  "baseBranch": "main",
  "worktreeDir": ".worktrees",
  "hangThresholdMinutes": 10,
  "approvalFallbackSeconds": 60,
  "enforceWorkflow": true,
  "smallTaskLines": 30,
  "localTest": { "when": "affected", "uiPaths": ["src/app/**", "src/components/**"], "apiPaths": ["src/api/**"] },
  "git": { "branchPattern": "feat|fix|chore/<topic>", "commits": "conventional", "merge": "squash", "prTarget": "main", "blockPushToMain": true, "blockForcePush": true },
  "gates": {
    "tests": "npm test",
    "lint": "npm run lint",
    "types": "tsc --noEmit",
    "audit": "npm audit --audit-level=high",
    "semgrep": "semgrep --config auto",
    "diffBudgetLines": 400,
    "maxFixRounds": 2,
    "human": ["spec", "plan", "merge"]
  },
  "reviewCouncil": {
    "first": "spec-reviewer",
    "parallel": ["code-reviewer", "security-reviewer", "leanness-reviewer", "test-reviewer"],
    "securityOnlyIfPaths": ["src/upload/**", "src/auth/**", "package.json", ".env*"],
    "synthesizer": "review-synthesizer"
  },
  "templates": [
    { "id": "feature", "workflow": "superpowers", "permissionMode": "default", "worktree": true },
    { "id": "bugfix", "workflow": "tdd", "worktree": true },
    { "id": "deps", "background": true, "gates": ["tests"] }
  ],
  "notifications": [
    { "on": "approval", "to": ["pad", "toast"] },
    { "on": "hang", "to": ["pad"] },
    { "on": "readyForReview", "to": ["toast"] },
    { "on": "ciFailed", "to": ["webhook"] }
  ]
}
```

## Interfaces

All parts talk only to the app's local API (`http://127.0.0.1:7420`, header `x-token`). The bridge mod cannot open a server itself. It reports through `$.http.fetch` and fetches commands by long-poll.

**Local API (draft)**

| Method | Path | From | Purpose |
| --- | --- | --- | --- |
| POST | `/events` | Bridge mod, hooks | Report an event (see below) |
| GET | `/sessions/{id}/commands/wait` | Bridge mod | Long-poll: fetch the next command for this session |
| POST | `/approvals` | Bridge mod | Request a permission, returns `id` |
| GET | `/approvals/{id}/wait` | Bridge mod | Long-poll for the decision (`allow`, `deny`, `pending`) |
| POST | `/approvals/{id}/decision` | App UI, pad | Set the decision |
| POST | `/hooks/permission-request` | Settings hook (type `http`) | Fallback route for permissions without the mod |
| GET | `/inbox` | Pad, Stream Deck | Open entries, sorted |
| POST | `/inbox/{id}/action` | Pad, Stream Deck | Allow, deny, open, Go |
| POST | `/sessions` | App UI, pad | New session from a template |
| POST | `/sessions/{id}/message` | App UI | Send an instruction or a reply |

**Bridge mod events** (JSON, each with `sessionId`, `projectPath`, `worktree`, `ts`)

| Event | Trigger in the mod | Content |
| --- | --- | --- |
| `session.started` / `session.ended` | `session.start`, `classic.SessionEnd` | Name, branch, model, permission mode |
| `turn.started` / `turn.completed` | `turn.start`, `turn.complete` | Duration, shortened last reply, aborted yes/no |
| `tool.used` | `tool.call` (after `next`) | Tool, short description, success, agent ID if present |
| `tasks.changed` | `tool.call` on TaskCreate / TaskUpdate | List with title, status, dependencies |
| `agents.changed` | Timer + `$.agent.list()` | Agents with role, status, runtime |
| `phase.changed` | Skill calls of Superpowers, files in `docs/superpowers/` | Phase, plan file, task n of m |
| `needs.you` | `tool.check` ask, questions, plan waiting | Reason, text, options |

**Commands to the bridge mod**

| Command | Effect in the session |
| --- | --- |
| `submit` | `$.prompt.submit({ text, asUser: true })`, waits until the session is free |
| `send` | `$.session.send(...)`, read between two tool calls |
| `toast` / `status` | `$.ui.toast` / `$.ui.status` |
| `openPane` | `$.ui.open({ id })`, e.g. Superpowers progress |

*Idea only, do not implement (E34).*

**Pad protocol (USB serial, one JSON per line)**

- App → pad: `{"t":"list","items":[{"name":"i18n-de","state":"needs","reason":"PLAN"}, …],"sel":0}` and `{"t":"led","key":1,"color":"amber"}`
- Pad → app: `{"t":"key","key":1}`, `{"t":"enc","delta":1}`, `{"t":"enc_press"}`
- The logic lives in the app. The pad only displays and reports keys.

*Idea only, do not implement (E34).*

**Pad form factors (mockups pad A–D, not yet decided)**

- **A · Compact:** 1.9″ display, rotary knob (choose session, press = open, long press = inbox), six keys Allow, Deny, Next, Plan Go, Side chat, Stop; the LED ring shows the worst state. Recommended to start with.
- **B · Deck:** 15 keys with their own image, row 1 live sessions, row 2 navigation, row 3 actions, several pages; layout per project in `.orchtopus/pad.json`. As an Elgato Stream Deck plugin or an ESP32-S3 with a 3.5″ touch screen.
- **C · Permission console:** 3.5″ display shows the whole command with risk notes, the knob scrolls through open permissions, large keys Allow, Later, Deny, plus "Pause all" behind a flip cover.
- **D · Dial:** round knob with a 1.28″ display and LED ring (one dot per session), two keys Allow/Deny; e.g. based on the M5Stack Dial.
- For all of them: The pad never decides on its own, dangerous commands cannot be allowed on the pad (open only), Stop needs a hold. The protocol above covers all form factors; for B, `{"t":"key_img","key":3,"text":"…","color":"amber"}` is added.

*Idea only, do not implement (E34).*

**Smartwatch (evaluation, not yet decided)**

The watch never talks to Anthropic, only to Orchtopus. So it needs no API key and no particular Claude subscription: The sessions keep running with your normal Claude Code login (Max too). The real hurdle is reaching Orchtopus, which listens only on `127.0.0.1`.

| Route | Effort | Requirements | Assessment |
| --- | --- | --- | --- |
| 0 · Claude Remote Control | none | Claude app on the phone, same account, Remote Control active; the phone mirrors notifications to the watch | Push only when Claude decides so or an action is needed; knows no Orchtopus gates and no inbox. Good as a complement. |
| 1 · Push service with action buttons (e.g. ntfy, self-hosted or ntfy.sh) | small | Phone app of the service; the watch mirrors phone notifications (Apple Watch, Wear OS, Garmin, Pebble) | Works with any watch. Buttons (Allow, Deny, Plan Go) call a URL that must reach Orchtopus, see below. **Recommendation for stage 1.** |
| 2 · Own Wear OS app | medium | Android phone (Pixel Watch/Galaxy Watch do not work with iPhone); development with Android Studio on Windows; install via ADB or Play Store | Own tile with sessions, notifications with actions, the watch can query directly over its own Wi-Fi. Best route for a real watch app on Windows. |
| 3 · Own Apple Watch app | high | iPhone, Mac with Xcode (not on Windows), Apple developer account for permanent installation | Requests to the local network do not go directly from the watch by default; a route via an iPhone app or a server on the internet is needed. Action buttons on notifications work well. |
| 4 · Garmin Connect IQ | medium | Garmin watch, Garmin Connect app; SDK runs on Windows | Web requests go through the phone app and require HTTPS with a valid certificate, even in the home network. Feasible with Tailscale HTTPS or a relay. |
| 5 · Pebble (Core Devices) | medium | Pebble 2 Duo / Time 2, Pebble app; open-source SDK (C or JavaScript) | Logic runs as JavaScript on the phone and may access the network; the keys on the watch fit Allow/Deny well. Niche, but open. |

**Other manufacturers (as of November 2026, re-check before implementation):**

- **OnePlus Watch 2/3, OPPO Watch X/X2/X3:** run Wear OS with Google Play, so same as route 2; officially only with an Android phone.
- **Huawei (HarmonyOS):** own watch apps with ArkTS (Watch 5 and newer) or JS for the Lite watches (GT, Fit), development in DevEco Studio. The phone app can send template notifications with its own buttons to the watch through **Wear Engine**; Wear Engine must be applied for at Huawei. Installing an app on the watch does not work when it is paired with an iPhone. Feasible, but more effort than Wear OS.
- **Xiaomi (HyperOS / Vela):** JS apps for Watch S3/S4, Redmi Watch 5 and bands; installing your own apps only through a debug route or after contacting Xiaomi. Realistic: mirrored phone notifications.
- **Honor:** no open SDK for current watches (third-party apps existed only on the Watch GS Pro). Mirrored notifications only.

Mockups: Wear OS (notification, dangerous command, tile, list, detail, complication) and the ecosystem comparison on the mockup canvas, row "Smartwatch".

**Reaching Orchtopus (applies to 1–5):**

- **Same Wi-Fi:** Let Orchtopus also listen on the LAN address, with token only. Simple, but does not work on the go, and Apple Watch and Garmin cannot reach it directly without HTTPS or a detour.
- **Tailscale/WireGuard:** Phone and PC in the same private network, reachable from anywhere; Tailscale can issue valid HTTPS certificates (helps with Garmin). Recommended.
- **Relay with outgoing connection:** Orchtopus fetches commands by long-poll from a small server or push topic; nothing on the PC is opened from outside. Works without a VPN, but needs a service on the internet.

**Rules for the watch:** Like the pad, it is only a remote control. Dangerous commands can never be allowed from the watch (only "open on PC"). Every action is bound to exactly one permission, expires after a few minutes and carries a token. The notification shows session, command and project, so you do not allow blindly.

## Non-functional requirements

| ID | Requirement | Target |
| --- | --- | --- |
| N1 | Platform | Windows 10/11 x64; terminal through ConPTY; macOS possible later |
| N2 | Timeliness | State change in board, inbox and pad in ≤ 2 s |
| N3 | Load | 10 concurrent sessions without noticeable delay; bridge mod ≤ 1 request per second and session when idle |
| N4 | Robustness | App crash or restart ends no session; the bridge mod keeps working without the app and falls back to the terminal question for permissions |
| N5 | Security | API only on `127.0.0.1` with token; no permission without a click; log of all permissions; no secrets in logs |
| N6 | Usability | Everything important by keyboard; contrast at least 4.5:1; state never by color alone (always text too) |
| N7 | Independence | Bridge mod and app are versioned; the app checks the Claude Code version at start and warns about missing mod functions (mods from v2.1.287) |
| N8 | Privacy | Everything local; network only for GitHub (`gh`) and an optional webhook |
| N9 | Maintainability | Project configuration as a documented JSON schema; reviewers as normal agent files |

## Limits, risks and checkpoints

The implementing session must check these points against the current Claude Code docs and with a small test before building. It records the results here and in the Changelog.

| ID | Checkpoint | Why it matters | If it does not work |
| --- | --- | --- | --- |
| P1 | Do mods load in background sessions (`claude --bg`), and do these survive closing an attached terminal on Windows? | Basis for E2 | Sessions as child processes; restore with `--resume` |
| P2 | Does `tool.check` with a repeated `$.http.fetch` long-poll hold for 60 s without the hook being skipped? Is `http://127.0.0.1` allowed as a target? | Basis for E7 | Settings hook `PermissionRequest` of type `http` (timeout up to 600 s) |
| P3 | Does the terminal question appear while a `PermissionRequest` hook is waiting, or only after it? | Fallback behavior | Use only the route through the mod |
| P4 | Do `tool.call` events from subagents carry an agent ID? | Last tool per subagent in the agent tree | Show only the status from `$.agent.list()` |
| P5 | Mod panes in the embedded xterm.js: full-screen display and width | Mod elements visible | Panes appear above the prompt (accepted) |
| P6 | Agent View on Windows: known bugs with orphaned processes | `claude agents --json` as a data source | Session list from the app database and mod events |
| P7 | Superpowers phases reliably detectable (skill calls, files) with the installed version | Phase and Plan Go | Derive the phase from files in `docs/superpowers/` |
| P8 | Are a CLAUDE.md section, tool.call blocks and follow-up prompts enough for Claude to keep to the workflow without getting into loops? Does this work with the Superpowers skills? | Basis for E18 | Reduce blocks to a few hard rules, the rest as an inbox hint |
| P9 | Does $.model.fork work from an app command while the session is working, and how long does a reply take? | Basis for the side chat | $.model.complete with a shortened history from $.session.messages() |

**Known limits (accepted on purpose)**

- The official Claude desktop app is not controlled; sessions there do not appear in Orchtopus.
- Permissions of other sessions can never be granted through messages between sessions.
- Mods run without a sandbox and with your rights.
- The field changes fast; several community tools were discontinued in 2026. So Orchtopus builds only on building blocks of Claude Code itself (CLI, mods, hooks).

## Implementation phases

Each phase ends with a verifiable acceptance. The implementation itself runs with Superpowers: per phase spec, plan, worktree, TDD, review.

| Phase | Scope | Acceptance |
| --- | --- | --- |
| 0 · Spike | Bridge mod prototype: `tool.check` holds Bash calls, mini web page on `localhost` with Allow/Deny, 60 s fallback. Checkpoints P1–P3, P6. | A permission from the browser takes effect on Windows; without an answer the terminal question appears |
| 1 · MVP | App skeleton (E14), local API, open project, restore, board, session view with terminal, inbox, permissions, stalled detection, gates G4/G5, settings global and per project, enforce workflow, diff with VS Code buttons | F01, F02, F04–F11, F13, F15, F17 met |
| 2 · Workflow | Superpowers phases, Plan Go, review council, gates G3/G6/G7/G9, overlaps, agent tree, "Since you were away", backlog, side chat, Advise, gate G5a | F03, F12, F14, F16, F18 met |
| 3 · Hardware | Pad firmware (ESP32-S3), pad driver, notification rules, optional Stream Deck | F19–F21 met |
| 4 · Expansion | CI watcher, several projects at once, notes | F22–F24 met |

## Open questions

- [ ] F1: Tauri or Electron? (Recommendation for phase 1: Electron with `node-pty` and xterm.js, because it is the most direct; check Tauri later.)
- [ ] F2: Which ESP32 board exactly (display size, number of keys, rotary knob)?
- [ ] F3: How many sessions typically run in parallel, and across how many projects?
- [ ] F4: Should the review council run on every PR or only above a diff size?
- [ ] F5: Where should the phone webhook go (e.g. ntfy, Telegram, Pushover)?
- [ ] F6: Should GitHub issues appear in "Start" automatically or only with a label?
- [ ] F7: Name of the app (working title "Leitstand") — resolved: Orchtopus.

## Mockups, earlier documents and sources

**Mockups** (Orchtopus – app mockup (older canvas, not included; see ../mockups/index.html)); the v2 series is authoritative:

- v2 · 1 Open project (older canvas, not included; see ../mockups/index.html)
- v2 · 2 Session view (older canvas, not included; see ../mockups/index.html)
- v2 · 3 Board with inbox (older canvas, not included; see ../mockups/index.html)
- v2 · 4 Review (older canvas, not included; see ../mockups/index.html)
- v1 · 3 ESP32 pad (older canvas, not included; see ../mockups/index.html) (still valid)

* v2 · 5 Settings (older canvas, not included; see ../mockups/index.html)
* v2 · 6 Session with side chat (older canvas, not included; see ../mockups/index.html)
* v2 · 7 Diff, VS Code and Advise (older canvas, not included; see ../mockups/index.html)

- v2 · 8 Session: info and side chat combined (older canvas, not included; see ../mockups/index.html) (authoritative for the session view; replaces v2 · 2 and v2 · 6)

* Layout variants of the session view: A Tab (older canvas, not included; see ../mockups/index.html), B Dock (default) (older canvas, not included; see ../mockups/index.html), C own column (older canvas, not included; see ../mockups/index.html), D reading width (older canvas, not included; see ../mockups/index.html)

- **v3 · after the prototype** (authoritative, replaces v2 · 4 and v2 · 7): session, inbox, review plan, diff with advisor, Review, review detail, request changes, open PRs, review someone else's PR, settings. Clickable in the [prototype](../mockups/prototype.html).
- Further series: Pets, Terminal, pad options A–D, Smartwatch (Wear OS, comparison).

**Earlier documents**

- Concept: managing Claude Code sessions (earlier research note, not published) (research on tools and building blocks)
- Claude Code Desktop – mod UI mockups (earlier research note, not published) (what mods can do in the desktop app)

**Sources (Claude Code docs)**

- [Mods: Events](https://code.claude.com/docs/en/plugins/mods/events), [API](https://code.claude.com/docs/en/plugins/mods/api), [Interface](https://code.claude.com/docs/en/plugins/mods/interface), [Reference](https://code.claude.com/docs/en/plugins/mods/reference)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Agent View](https://code.claude.com/docs/en/agent-view), [Agent Teams](https://code.claude.com/docs/en/agent-teams), [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [Superpowers](https://github.com/obra/superpowers)

**Inspirations:** [Emdash](https://github.com/generalaction/emdash), [Vibe Kanban](https://github.com/BloopAI/vibe-kanban), [claudectl](https://docs.rs/crate/claudectl/0.15.5/source/README.md), [superpowers-statusbar](https://github.com/AdrienGras/superpowers-statusbar), [superpowers-panel](https://github.com/tobecwb/superpowers-panel), [agentsd](https://github.com/paultyng/agentsd), [ESP32-VibeOrb](https://gitee.com/panzi/ESP32-VibeOrb)

## Changelog

New entries on top. Every change to decisions (E), requirements (F, N) or checkpoints (P) gets a row here.

| Date | Change |
| --- | --- |
| 2026-11-26 | Renamed from the working title "Leitstand" to Orchtopus, including paths and markers (`.orchtopus/`, `%APPDATA%\Orchtopus`, `orchtopus:start`). Document translated from the German original to English. |
| 2026-11-26 | App skeleton decided: Electron (E14). No more precautionary limits for sessions, test environments, background jobs and stack depth (F69, F74). Learnings (F72) on every merge instead of once a day; discarded items come back on new evidence. |
| 2026-11-26 | Project-specific names removed, examples made generic (E36); bridge mod idea only, agent adapter layer (E35). New: crash/restart, usage view (F67), model and effort per role (F68), resources (F69), secret filter (F70), project onboarding (F71), capturing learnings (F72), keyboard (F73), stacked PRs/MRs (F74). Issues postponed. |
| 2026-11-26 | Pad and smartwatch marked as idea only (E34, F20 set to "Idea only"); notes on the system design added so both can be connected later without a rebuild. |
| 2026-11-26 | Wiki: chapter menu on the right and search bar always visible (F64). New: default text style about 80 % ASD-STE100 plus i-have-adhd (E32, F65); Orchtopus split into versioned building blocks for easy updates (E33, F66). |
| 2026-11-26 | New: rendered chats in all panels (F61); context control by Orchtopus with display, thresholds, fresh session with handoff or targeted compaction (E31, F62); three input routes question, course correction, new instruction (F63). |
| 2026-11-26 | New: project wiki as HTML outside the repo with altitude levels, diagrams and automatic updates (E28, F57, F58); session type "Investigate" instead of a separate mode (E29, F59); GitHub/GitLab integration through gh and glab with pipeline status, reviews and comments (E30, F60). |
| 2026-11-26 | Favorites Signal Bloom, HUD Brackets and Prism Glass noted. New: swappable themes through design tokens (E27), light/dark and design variant in settings (F55), themes as modules without component changes (F56). |
| 2026-11-25 | Design skill unslop (heydamir) anchored as a fixed step for every interface (E26), with the direction "Stellwerk in the night shift"; mockup series for the text and design pass added. |
| 2026-11-24 | Five color versions each for Clay Studio and Floating Islands (light and dark). |
| 2026-11-24 | Styles 7–14 removed; five layered, rounded styles L1–L5 (light and dark) after feedback and the frontend-design skill. |
| 2026-11-24 | Layout concepts 7–14 removed; instead eight bolder styles for the existing components (dark and light). |
| 2026-11-24 | Eight more layout concepts (Orbit, Swimlanes, Triage Palette, Multiplexer, Cockpit, Living Document, Branch Graph, Arcade Crew) as mockups. |
| 2026-11-24 | Six design directions (dark and light) as mockups, derived from impeccable, taste-skill and UI UX Pro Max; selection open. |
| 2026-11-24 | Prototype switched to English (E25). New: agreed steps from the advisor to sessions (F49), rendered spec/plan editor (F50), need cards above the session (F51), permission card with explanation instead of a popup (F52), colors per decision type (F53), missing buttons added (F54). |
| 2026-11-24 | Prototype aligned with all mockup series: terminal with tabs, folder (project root/worktree) and shell choice; pad A and pad C (permission console with "Pause all"); virtual Wear OS watch (watch face with complication, tile, list, detail, notifications, dangerous only "On PC"); settings for notifications (toast/pad/watch) and pets (figure, name, animation). |
| 2026-11-24 | Mockup series v3 created from the prototype (10 views); counts as the authoritative state for Review, diff and plan. |
| 2026-11-24 | Smartwatch extended: Huawei, Xiaomi, Honor, OnePlus/OPPO assessed; Wear OS mockups and ecosystem comparison on the mockup canvas. |
| 2026-11-24 | Feedback on the prototype: spec/plan view with editor and chat, advisor chat in all review views, Back/Close, gates reset on a change request, review detail, PR instead of merge (E24), Git/PR reviewers and other people's PRs (to be evaluated), local start profiles, movable areas, modular panels (F38–F48). Note added that options must be questioned before implementation. Prototype updated. |
| 2026-11-24 | Smartwatch evaluated (Remote Control, push service, Wear OS, Apple Watch, Garmin, Pebble; reachability via Wi-Fi, Tailscale or relay). Clickable prototype: ../mockups/prototype.html |
| 2026-11-23 | Four pad form factors as mockups (A Compact, B Deck, C Permission console, D Dial) and described in the Interfaces section; selection open. |
| 2026-11-23 | F37: open the project in Windows Explorer, in VS Code and in Windows Terminal (own windows); buttons added in the mockup "Terminal". |
| 2026-11-23 | Project terminal below the main session added (E23, F36), mockup "Terminal · Session with project terminal below". |
| 2026-11-23 | Pets worked out: speed by activity, speech bubbles, name, optional level, format for custom figures, inspirations. Mockups Pets · 1 and 2. |
| 2026-11-23 | New: sections "Keeping the Git state current" (F35) and "Pets" (F34, E22); settings extended with pets and Git update. |
| 2026-11-23 | E21 clarified: an open chat collapses the info into the header; new reading width. Mockups layout A–D added. |
| 2026-11-23 | E21: session info and side chat combined in one column (mockup v2 · 8 replaces v2 · 2 and 6). Layout set per window width. |
| 2026-11-23 | Added: settings global/project (E16–E18, F25–F30), side chat and Advise (E19, F31–F32), diff with VS Code (E20, F33), gate G5a Test locally, checkpoints P8–P9, mockups v2 · 5 to 7. |
| 2026-11-23 | First version: goals, decisions E1–E15, requirements F01–F24 and N1–N9, permission flow, gates and review council, persistence, interfaces, checkpoints P1–P7, phases. Basis: mockups v2. |
