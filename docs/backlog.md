# Backlog

Ideas that are not part of a milestone yet. Each entry says what it is, what was found out, and what it would need. An idea moves into a milestone spec only after the user says so.

## Sandboxed sessions through WSL2 (opt-in per project)

Added 2026-11-28. Status: researched once, needs a spike. Suggested place: M5 (robustness) or its own milestone after M4.

**What:** a project can be set to run its sessions inside WSL2 instead of native Windows, with Claude Code's sandbox switched on. Native Windows stays the default.

**What the research found** (official docs and Microsoft docs, 2026-11-28; check again before building):

- Claude Code's sandbox does not exist on native Windows (commands run unsandboxed there) and not on WSL1. It works on WSL2, Linux and macOS. WSL2 needs `bubblewrap` and `socat`.
- The sandbox limits writes to the working folder, a temp folder and added folders, and puts the network behind a proxy with an allow list that starts empty. Reads are not limited by default (`~/.ssh` needs a `denyRead`). It covers shell commands and their children only; file tools, MCP servers and hooks run outside it. UDP is blocked, tools that ignore proxy variables fail, Docker does not work inside it.
- `sandbox.failIfUnavailable: true` makes Claude Code exit when the sandbox cannot start. Never set it for native Windows projects; set it for WSL projects so a broken sandbox never runs silently unsandboxed.
- The repository and worktrees belong on the Linux file system (ext4), not under `/mnt/c`. The distro has its own `~/.claude` and `~/.claude.json`: a separate Claude Code login and a separate workspace trust.
- Hooks must reach the app's local API. With WSL2 mirrored networking (`networkingMode=mirrored`), Linux reaches Windows on `127.0.0.1`. In the default NAT mode the API would have to listen on another interface, which changes the security model; do not do that.
- Other isolation options with network isolation: the sandbox runtime `srt` (beta, wraps the whole process including hooks), dev containers (Docker), cloud sessions. On this machine WSL2 plus bubblewrap is the lightest, because Docker Desktop adds its own VM.
- Resources: see "Resource-aware sessions" for measured values. WSL2 is one VM for all sessions; its default memory cap is 50 % of Windows RAM. Suggested caps (inference): 9 to 10 GB on a 16 GB machine, 18 to 20 GB on a 30 GB machine.
- Working on WSL files from Windows (documented): Explorer opens `\\wsl.localhost\<Distro>\home\<user>\…` (`explorer.exe .` from inside WSL); VS Code uses the official WSL extension (`code .` in a WSL terminal), so git, language servers and terminals run inside Linux. Do not open the share as a plain Windows folder, and do not run Windows git or Node on it. Small hand edits (an `.env` value) are fine while no session runs. Keep LF line endings on both sides.
- Further risks (documented): Windows interop (`/mnt/c`, `.exe`) is reachable from the sandbox unless the seccomp filter (`@anthropic-ai/sandbox-runtime`) is installed or interop is disabled in `wsl.conf`; Ubuntu's AppArmor user-namespace setting can break bubblewrap; the sandbox alone is not meant for fully unattended runs (the docs point to containers, VMs or `srt` for that).

**Decided with the user (2026-11-28):** a setting per project with a setup assistant; native Windows stays the default until Orchtopus can move a project into WSL itself, then it can become the default. The benefit is not limited to unfamiliar repositories: any session that runs install scripts, reads web pages, issues or dependencies profits from the network allow list and the write limits. Not before M4. Basis: `docs/evidence/claude-code-setup.md` [EV-I1].

**Ideas from the multi-agent article** (Anthropic blog on scaling agent teams, a research run, not Claude Code): one isolated VM per agent without network and without credentials, a gateway as the only way out, each agent pushes only its own branch, a classifier checks every tool call and fails closed. Orchtopus already has the branch rule and the hard-block hooks; the WSL sandbox is the local, practical version of the VM idea.

**Fits the architecture because** the UI knows only the `AgentAdapter`. A WSL variant of the background adapter runs `wsl.exe -d <distro> -- claude …`, translates paths and adds the sandbox settings to the generated settings file. Nothing else changes.

**Spike first (about half a day):**

1. `wsl.exe -d <distro> -- claude --bg` starts a session, and `claude agents --json` reads it from Windows.
2. `claude attach` through node-pty and `wsl.exe`: colours, resize, Ctrl+C.
3. A hook inside WSL reaches the Windows API on `127.0.0.1` with mirrored networking, including the Windows firewall. If this fails, the WSL path needs another transport; stop there.
4. First login and trust prompt inside the distro, started from the app.
5. A worktree on ext4 plus `npm ci` inside the sandbox with an allow list (npm registry, git remote).
6. Memory with 3 parallel sessions at the current 6 GB cap and at 12 GB.

**Open:** how the user opens a WSL worktree in VS Code and Explorer (`\\wsl$` paths), line endings (`core.autocrlf=input`, `.gitattributes`), whether the setup check should offer the `.wslconfig` change or only explain it.

## Usage-aware orchestration

Added 2026-11-28. Status: idea, researched once. Suggested place: M5 (usage view, models and effort per role, F67, F68).

**Problem:** on a Max subscription, a lead session plus many agents reaches the 5-hour and weekly limits. A run then stops in the middle of work.

**What the research found** (official docs and support pages, 2026-11-28; check again before building):

- Max has a 5-hour limit and a weekly limit, shared by Claude and Claude Code and by all models. Fable has no pool of its own: it draws faster from the normal weekly limit, and at most 50 % of the weekly limit can go to Fable without usage credits (support page "Claude Fable models on your plan"; corrected 2026-11-28, an earlier note here said "separate weekly limit"). No source gives numbers for how much faster Fable or Opus use the allowance than Sonnet; Opus "costs several times more per turn than Sonnet".
- Effort guidance (platform docs "Effort", vendor guidance without published sweeps): Opus 5.5, Sonnet 5.5 and Haiku 5.5 default to `medium`; `high` is the starting point for harder or longer work; Fable 5.2 starts at `high`, `xhigh` only where a gain was measured, `max` often adds little at a much higher cost; Haiku at `low` more often skips checks in long agent prompts; subagents are a typical `low` use.
- Benchmarks (vendor tables, relayed by third parties, not like-for-like): Fable 5.2 leads on long-horizon work (Remote Labor Index about 41 % against 21 % for Opus 5.5) and is about level with Opus 5.5 on coding at `high`; Sonnet 5.5 is close to Opus 5.5 on coding benchmarks at half the price. No benchmark measures an orchestrator or lead role.
- Anthropic's multi-agent research post (2025, research tasks, Opus 4 lead with Sonnet 4 workers): token use explained about 80 % of the performance variance; multi-agent runs used about 15 times the tokens of a chat; subagents typically returned condensed results of 1,000 to 2,000 tokens or a reference to a file. Not yet repeated for coding or for the current models.
- The status line has `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage`, `resets_at`) and prompt cache data. `/usage` attributes usage to skills, subagents, plugins and MCP servers.
- Model and effort per agent are set in the agent file (`model`, `effort`) or per call. Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.2 default to `medium`; Anthropic states Opus 5.5 at `medium` matches Opus 5 at `high`. `max` effort is described as prone to overthinking.
- Prompt cache: each model has its own cache, so switching the model of a running session recomputes everything; changing effort keeps the cache on the current models. Subagents and workflow agents cache for 5 minutes by default. `/compact` is a large request; `/clear` is free.
- A long session re-reads its whole history on every request. Many detailed subagent results fill the lead's context.

**Ideas for Orchtopus:**

1. Usage bar with burn rate: 5-hour and weekly use, the time to the reset, and a forecast ("at this rate the limit is reached in 40 minutes"). Warn before a limit, never cap (F69).
2. Defaults per role from the evidence register [EV-M1 to EV-M7], each a setting: lead Opus 5.5 `high`, Fable 5.2 selectable per task or phase (with the 50 % weekly share shown), Opus `high` for critical reviews, Sonnet for checklist reviews, summaries and mechanical work, Haiku only for classification and routing. Optional: an advisor (Opus) recommends Fable or Opus for a task and shows its reason; Claude Code's own advisor tool is the documented mechanism to build on [EV-M3]. Orchtopus records fix rounds and usage per role, so the defaults can be checked against data (an A/B of Sonnet against Opus implementers is the first candidate).
3. Cache awareness: never switch the model of a running session; suggest a fresh session at a task boundary instead of a compaction in the middle of work (D7).
4. Parallel lanes from the plan: Orchtopus reads the task dependencies of an approved plan (what each task consumes) and proposes which tasks can run in parallel sessions, with a cap on concurrent heavy sessions that the user sets. The M1 build did this by hand and saved about a third of the time. A shared task board (idea from Anthropic's 1,000-agent post, where agents claimed tasks from shared tables and split them into subtasks) fits here: the tasks of an approved plan go onto the board in the state store, and free sessions take the next task whose dependencies are done. The user's gates stay in front: only tasks of an approved plan go onto the board, and every result still ends in a PR the user releases. **Decided with the user (2026-11-28):** build it, as an Orchtopus-owned board in the SQLite event log (tasks, dependencies, claims, notes, splits, landed results), not on Claude Code agent teams [EV-I2]. Orchtopus assigns a task to a session with a brief (objective, output format, files owned, check); sessions report through the hook helper and the local API; a split proposed by a session goes to the user or into a budget the user sets; two open tasks that own the same files raise the overlap warning. Open checks: whether `CLAUDE_CODE_TASK_LIST_ID` works with background sessions, and how reliably plan dependencies can be parsed. Suggested place: with the board in M5.
5. Limit pauses: when a session hits a limit, show "paused until <time>" and continue it after the reset with one click.

**Open:** whether usage per session can be measured at all (the status line limits are per account), and how to estimate a forecast from whole-percent steps.

## Resource-aware sessions (16 GB machines)

Added 2026-11-28. Status: measured once on the 30 GB machine. Suggested place: M5 ("resources and ports", F69).

**Problem:** the user's work laptop has 16 GB RAM. Many parallel sessions plus the project's own tools can fill it.

**Measured** (2026-11-28, Claude Code 2.1.332, Windows 11, Haiku, median of 3; working set / private bytes):

| What | Working set | Private bytes |
|---|---|---|
| One idle background session (one `claude.exe`) | about 300 MB | about 600 MB |
| One session while a Bash tool runs (with shells and Node) | about 380 MB | about 610 MB |
| Claude Code supervisor (once for all sessions) | about 230 MB | about 410 MB |
| Three sessions plus supervisor | about 1.6 GB | about 2.4 GB |
| `npm i -D vitest` (peak) / a trivial vitest run (peak) | about 380 / 280 MB | about 340 / 190 MB |

Not measured yet: the Orchtopus app itself, real project tools (a full test suite, a dev server, `tsc`), the 16 GB laptop.

**Findings:** the fixed cost per session is the `claude.exe` worker, not the model. The project's tools come next and vary a lot. Private bytes are about twice the working set, so the commit limit matters as much as free RAM.

**Ideas for Orchtopus** (the rule "show load, warn, do not cap by default" stays):

1. Show RAM per session and in total, read live from the process tree, plus free memory and the commit charge.
2. Warn before starting a session when free memory is low; offer "start when memory is free" as a queue the user turns on. The thresholds are settings; the first values (warn below about 3 GB free, suggest waiting below about 2 GB) are the lead's estimate from the measurement above, to be checked on the 16 GB laptop.
3. Suggest fewer parallel lanes (see "Usage-aware orchestration") when memory is short.
4. Rough guide from the measurement (estimate): a 16 GB machine with Windows, VS Code and a browser open has room for about 4 to 5 active sessions; a 30 GB machine is limited by usage and review capacity first, not by memory.

**Next step:** measure the same table on the 16 GB laptop and with a real project test run.

## Plans and specs that are quick to review

Added 2026-11-27. Status: idea, to be evaluated. Updated 2026-11-28: user decision below.

**Problem:** plans and specs that the user must approve are often long, dense and tiring to read (the M1 plan has about 750 lines). A long review is easy to put off or to skim, and then the approval means little.

**Idea 1, smaller review packages:** split what the user must read into short parts, for example several 2-minute reads instead of one long one. Possible shapes:

- A one-page summary per plan for the user (what gets built, what the risks are, which decisions are the user's), with the full plan kept for the agents.
- Approval per part (for example per group of tasks or per milestone phase) instead of one approval for everything.
- Only the parts that need a human decision are marked for review; the rest is "for information".

**Idea 2, nicer presentation:** show plans and specs so they are pleasant to read: rendered page with headings, short sections, diagrams of the flow, progress per task, colour labels that say what needs the user (red) and what is information (green), collapsed details.

**Decision 2026-11-28 (user): HTML review pages inside Orchtopus.** The user reviews specs and plans as designed HTML pages, not as Markdown or rendered Markdown. This supersedes F50's rendered Markdown editor as the default view.

- Proposed by the lead: the session writes an HTML review page next to the Markdown plan. The Markdown stays the agents' source of truth and is what gets committed. The HTML page is a view: it lives in the Orchtopus data folder and is never committed.
- The session writes these files through superpowers, not Orchtopus. Keeping them in the repository is the user's per-project choice, so this does not break "Orchtopus writes nothing into user repos".
- Proposed by the lead: the page comes from a versioned building-block template that uses design tokens. It has a short summary on top, red "needs you" and green "info" labels, flow diagrams, collapsible details and progress per task.
- Proposed by the lead: Orchtopus shows the page in the plan view, with Spec OK and Plan Go on it, and a raw-text fallback.
- Proposed by the lead: Orchtopus checks that the HTML and the Markdown belong to the same revision. The session regenerates the HTML on every change.
- Source: Thariq Shihipar's essay on HTML as the plan format, 2026-05-20 (https://claude.dev/blog/using-claude-code-the-unreasonable-effectiveness-of-html/). He does not read Markdown plans over about 100 lines. See `docs/research/2026-11-28-playground-and-staff-setups.md`, section 2.4.
- Design chosen 2026-11-28 (user): direction D, "Map with parts", with "Needs you" in the document's signal colour. Follow-up after the template spec is approved: a DESIGN.md section for the review page and the label rule. Explorations: `docs/design/explorations/2026-11-28-plan-review/`. Template, markup contract and the revision check: `docs/specs/2026-11-28-review-page-template-design.md`. Open points for the build (the design stays as it is):
  - Spike: does fragment navigation work on an opaque-origin `srcdoc` frame? The parts strip needs it to jump to a part.
  - Mock of the decisions panel (host panel built from the page's `data-need` items).
  - Map node labels are truncated when the "needs you" lamp is shown.
- New project setting **"Keep specs and plans in the repository"**. Default yes, as superpowers does. When off, they live in the Orchtopus data folder and stay out of the PR.

**Where it applies:**

- Our own workflow in this repository (the lead's specs and plans).
- The product: the spec and plan view of M3 (F38 to F41, F50) shows superpowers plans to the user. The same ideas would make that view better.

**To evaluate:** whether smaller approvals still catch cross-task problems; how much extra work the summary costs per plan; whether superpowers' plan format allows a separate user summary without changing the skill; which presentation (rendered Markdown in the app, an artifact page, a generated HTML file) fits best.

## Guard commands that lose work (blast radius)

Added 2026-11-28. Status: idea, researched once. Suggested place: M2 (dangerous commands, hold card, product spec 5.3).

**Decision 2026-11-28 (user):** Orchtopus also serves users who are not experienced developers. So by default, anything that can lose work counts as dangerous, also inside the session's own worktree:

- `git clean`
- `git checkout -- .` and `git restore .`
- `git reset --hard`
- force pushes, including `+refspec` and `--force-with-lease`
- migrations

**Card:** it explains in plain words what would be lost: files and sizes, dirty files, dropped commits. The same summary goes into the deny reason, so Claude can tell the user what was avoided.

**How:** compute it in the main process with Node `fs` and `git`, never by running project tools. Read-only. Do not run migration listers: they load project code before the user decides. For force pushes, say "as of the last fetch".

**Settings:** every rule is a setting the user can toggle in the settings.

**Source:** the Blast Radius mod in `anthropics/claude-code-playground` (`blast-radius.mjs`, last commit 2026-10-01). Its known misses (`xargs rm`, `find -delete`, `timeout 5 rm`, `doas rm`) become test cases. Details: `docs/research/2026-11-28-playground-and-staff-setups.md`, sections 2.1 and 2.2.

**Effort:** about 8 to 12 hours with tests.

## User mods in Orchtopus sessions

Added 2026-11-28. Status: needs a check in M2, before the dangerous-command hold ships.

**Finding:** mods load by default from Claude Code v2.1.287, and only `--safe-mode`, `--bare` or `disableAllHooks` turn them off. Orchtopus passes none of these, so a user's installed mods probably load in our sessions. This is an inference and is not tested. See [EV-I3].

**Risks:**

- A mod can approve tool calls that `PreToolUse` hooks would stop (the built-in guard prevents this by default).
- Double holds: a mod such as Blast Radius and our hook both hold the same command.
- Our PR block or dangerous-command hold being bypassed.
- `disableAllHooks` is no fix: it also stops our own hooks.

**The M2 spec must test this and decide.** Test with Blast Radius installed, and with a mod that approves a command that our hook holds. Possible outcomes: an information line in the setup check that lists mods with hooks, or `--safe-mode` for sessions that need a hard guarantee. Reading the plugin list stays read-only.

## Checks out of the change's reach

Added 2026-11-28. Status: idea, researched once. Suggested place: M3 (gates) and M4 (review).

**Source:** Addy Osmani (Anthropic), 2026-11-16, https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/

**What to take:**

- Load gate rules from the base branch or the data folder, never from the worktree.
- Flag a diff that changes check config (lint, test, CI files, `package.json` scripts) as "judge changed". The user decides.
- Stamp each commit with how it was verified, "none" included. Show the stamp in the review detail.
- Gate modes: off, observe, enforce. Every new gate starts in observe.

**Open difference:** his team brings in a human after 3 failed rounds. Our setting default is 2 [EV-H1]. Both are settings. Recheck in M4 and decide the default with a reason.

**Effort:** stamps and observe mode about 1 day. Base-branch loading and "judge changed" detection 1 to 2 days.

## Review council additions (M4)

Added 2026-11-28. Status: idea, researched once. Suggested place: M4 (review council, E11, F16, F42, F44).

**Verified ideas to add. This is additive: our own reviewers do the work and none is removed.**

- **Decision 2026-11-28 (user suggestion, adopted by the lead):** our own reviewer agents verify each finding before it counts. This adds to the review and removes no reviewer. The verifier reads code. It does not build or run it. Source: Code Review docs and Lydia Hallie's talk (date unverified).
- Reviewer depth follows a review level set by the owner: Quick, Standard, Deep. This is not the risk tier.
- Human approvals per path, like Claude Approvals (`.claude/approvals.yml`). "Risk tier" there means the number of human approvals per path, that is the number of human reviewers. Orchtopus may read an existing policy read-only to show "needs 2 people" on the board. It never writes one into a user repo.
- A "pre-existing" severity, so authors are not blamed for old bugs.

**Not adopted:** auto-merge of low-risk PRs (E24).

**Effort:** finding verification and severity tags 1 to 2 days. Per-path approvals label about 1 day.

## Cross-session messaging

Added 2026-11-28. Status: spike of about 0.5 day. Suggested place: M5 (board, overlap warnings, usage).

**What it is:** documented same-machine messaging between sessions. On native Windows it needs v2.1.234 and uses a named pipe. The pipe path is `CLAUDE_CODE_MESSAGING_SOCKET`. A first line with `CLAUDE_CODE_MESSAGING_TOKEN` is required. See [EV-I4] and [EV-I5].

**Uses:**

- Continue a session after a usage reset, without typing into the PTY.
- Overlap warnings: tell the affected sessions when one lands a change (F14).
- Course corrections to a running session.

**Rule:** Orchtopus must set `crossSessionInbound` (`accept`, `hold` or `refuse`) explicitly in its `--settings`. When unset, the behaviour depends on the permission modes.

**Spike questions:** can our hook helper post to its own session's pipe on Windows; does a background session bind a pipe; what does `hold` look like. Messages count toward usage and loops are only throttled, so Orchtopus sends and sessions do not chat freely.

## Claude Code Projects: precedent, not a building block

Added 2026-11-28. Status: researched once, one optional spike.

**Finding:** Projects has no CLI and no API, works with github.com only, and is not on Team or Enterprise. Orchtopus cannot call it. Sources: https://code.claude.com/docs/en/claude-projects and https://claude.com/blog/projects-redesigned (2026-09-17).

**Ideas to take:**

- A **Landing** state on the board, derived from the PR (approved or queued to merge) with `gh` or `glab`.
- Continue after a usage reset, on by default, one switch per project.
- CI events wake the session. We poll `gh` and `glab` ourselves (no model cost) and wake a session only on an event. On native Windows the local `/steward` watch does not start, so we need our own watcher.
- Auto-resolve after N idle days.

**One possible bridge:** host `claude remote-control --spawn worktree --settings <ours>`, so that Projects threads run locally under our hooks. Unproven. It needs a claude.ai sign-in and an awake machine. Spike of about 0.5 day, only if users ask for Anthropic's coordinator. Open: does a spawned thread use our hooks, and can we attach a PTY. Hosting it would need a second `AgentAdapter` implementation, and `attach` to such threads is unverified.

## Dev-workflow items for this repository

Added 2026-11-28. Status: small tasks, not product work.

- **Protect `main` with a ruleset.** PR plus green CI, no required human approval, because the lead merges itself. The user must set it in GitHub. It is currently unprotected (`gh api` says "Branch not protected"), so "never push to main" is text only.
- **Dependabot.** Weekly `github-actions` and `npm`, grouped. Keep major updates of `electron`, `node-pty` and `better-sqlite3` separate. `npm run smoke:native` already guards native modules.
- **PR template.** Short: summary, definition of done, agents with model and effort.
- Lower value: a dependency licence check as an npm script, `SECURITY.md` (with private vulnerability reporting), and a not-affiliated line in the README.

## Last-turn change list and context delta per turn

Added 2026-11-28. Status: idea, read in the playground code, not tested. Suggested place: M4 (review detail) or M5 (board).

**Last-turn change list:** show what a session changed in its last turn, one diff at a time. It answers "what did this session just do" faster than the branch diff (F33) and fits F03 "since you were away". Use `PostToolUse` for Edit and Write, so failed edits do not show. It misses edits made through Bash. File contents in the event log must pass the secret filter (F70) and a size cap, and the spool line cap of 4 KiB means content cannot go through the spool as is. Effort: 8 to 12 hours.

**Context delta:** keep one reading per turn and show tokens of the window plus the change since the last turn (a big file read shows up). Note: the percent of the full window differs from Claude Code's own notice, which counts to the auto-compact point (81 % against 90 % in their test). No thresholds (EV-C4). Effort: 3 to 4 hours.

**Check first:** field names for subagent ids in hook input and for status line tokens.

**Source:** `replay-theater.mjs` and `token-weather.mjs` in `anthropics/claude-code-playground`.

## Logitech MX Master 4 integration

Added 2026-11-27. Status: idea, researched once.

**What:** use the mouse as a second signal and input for "needs you": a short haptic pulse when a session needs the user, different patterns per kind of event, and mouse buttons or Actions Ring entries for quick actions (open inbox, next session that needs me, allow once, deny).

**What the research found** (sources checked on 2026-11-27, to be checked again before building):

- The MX Master 4 has a controllable haptic motor and the on-screen Actions Ring. Both depend on Logi Options+ and its plugin service running.
- Third parties integrate through the Logi Actions SDK. Plugins are written in C#; the Node.js SDK was discontinued. A plugin can define actions and raise haptic events that map to predefined waveforms. Custom waveforms are not offered. Plugins can be installed locally for personal use or published through Logitech's marketplace.
- A community plugin (HapticWeb, MIT) exposes the predefined waveforms over a local HTTP and WebSocket endpoint, so an app can trigger a pulse without writing its own plugin. It is a single-maintainer project.

**Possible steps, cheapest first:**

1. No code on the mouse side: Orchtopus offers global shortcuts for the quick actions (already planned as optional in F73); the user maps mouse buttons or ring entries to them in Logi Options+.
2. Haptics as a notification channel: a channel in the notification rule layer that calls a local haptic endpoint. Suggested mapping: one pattern for a permission, one for a stalled session, one for "ready for review".
3. Own plugin in C#: native Actions Ring entries with live state (for example the number of waiting decisions) and haptics without a third-party plugin.

**Fits the architecture because** every action already goes through the local API and notifications go through a rule layer with pluggable channels (E34).

**Rules that still apply:** a dangerous command can never be allowed from the mouse, only opened. Allow once for a normal permission from a mouse button needs the same care as a hotkey: only for the card that has the focus.

**Open:** licence terms of the SDK and the marketplace, how stable haptics are on Windows, whether the session that needs the user can be shown in the ring.
