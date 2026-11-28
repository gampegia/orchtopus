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
- Resources (estimate, not documented): about 0.3 to 0.6 GB per Claude process plus the project's own tools (0.5 to 2 GB for npm installs, tests, dev servers). WSL2 is one VM for all sessions. The machine has about 30 GB RAM; the WSL cap in `.wslconfig` is 6 GB today, which is tight for 3 to 5 sessions.

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

- Max has a 5-hour limit and a weekly limit, shared by Claude and Claude Code and by all models. Max also has a separate weekly limit for Fable, and Fable can bill to usage credits. No source gives numbers for how much faster Fable or Opus use the allowance than Sonnet; Opus "costs several times more per turn than Sonnet".
- The status line has `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage`, `resets_at`) and prompt cache data. `/usage` attributes usage to skills, subagents, plugins and MCP servers.
- Model and effort per agent are set in the agent file (`model`, `effort`) or per call. Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.2 default to `medium`; Anthropic states Opus 5.5 at `medium` matches Opus 5 at `high`. `max` effort is described as prone to overthinking.
- Prompt cache: each model has its own cache, so switching the model of a running session recomputes everything; changing effort keeps the cache on the current models. Subagents and workflow agents cache for 5 minutes by default. `/compact` is a large request; `/clear` is free.
- A long session re-reads its whole history on every request. Many detailed subagent results fill the lead's context.

**Ideas for Orchtopus:**

1. Usage bar with burn rate: 5-hour and weekly use, the time to the reset, and a forecast ("at this rate the limit is reached in 40 minutes"). Warn before a limit, never cap (F69).
2. Defaults per role that follow the docs: Opus `medium` for implementing sessions, Opus `high` for critical reviews, Sonnet for checklist reviews, Haiku for summaries. Fable only when the user picks it on purpose, with a note that it has its own weekly limit.
3. Cache awareness: never switch the model of a running session; suggest a fresh session at a task boundary instead of a compaction in the middle of work (D7).
4. Parallel lanes from the plan: Orchtopus reads the task dependencies of an approved plan (what each task consumes) and proposes which tasks can run in parallel sessions, with a cap on concurrent heavy sessions that the user sets. The M1 build did this by hand and saved about a third of the time.
5. Limit pauses: when a session hits a limit, show "paused until <time>" and continue it after the reset with one click.

**Open:** whether usage per session can be measured at all (the status line limits are per account), and how to estimate a forecast from whole-percent steps.

## Plans and specs that are quick to review

Added 2026-11-27. Status: idea, to be evaluated.

**Problem:** plans and specs that the user must approve are often long, dense and tiring to read (the M1 plan has about 750 lines). A long review is easy to put off or to skim, and then the approval means little.

**Idea 1, smaller review packages:** split what the user must read into short parts, for example several 2-minute reads instead of one long one. Possible shapes:

- A one-page summary per plan for the user (what gets built, what the risks are, which decisions are the user's), with the full plan kept for the agents.
- Approval per part (for example per group of tasks or per milestone phase) instead of one approval for everything.
- Only the parts that need a human decision are marked for review; the rest is "for information".

**Idea 2, nicer presentation:** show plans and specs so they are pleasant to read: rendered page with headings, short sections, diagrams of the flow, progress per task, colour labels that say what needs the user (red) and what is information (green), collapsed details.

**Where it applies:**

- Our own workflow in this repository (the lead's specs and plans).
- The product: the spec and plan view of M3 (F38 to F41, F50) shows superpowers plans to the user. The same ideas would make that view better.

**To evaluate:** whether smaller approvals still catch cross-task problems; how much extra work the summary costs per plan; whether superpowers' plan format allows a separate user summary without changing the skill; which presentation (rendered Markdown in the app, an artifact page, a generated HTML file) fits best.

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
