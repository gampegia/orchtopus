/* Shared sample content for the three review-page directions.
   Taken from docs/plans/2026-11-27-m1-walking-skeleton.md and
   docs/specs/2026-11-27-m1-walking-skeleton-design.md. The product page
   is static HTML that the session writes from the template; the
   explorations render from this one object so all three directions
   show exactly the same facts. */

window.REVIEW = {
  plan: {
    kind: "Plan",
    title: "M1 walking skeleton",
    source: "docs/plans/2026-11-27-m1-walking-skeleton.md",
    sha256: "2ac7d468bf17476d0ff2146670e390f5aa73e10a298876713d3fefc0a781c22d",
    template: "review-page/plan 0.1.0",
    written: "2026-11-27 18:40",
    session: "lead · orchtopus",
    branch: "feat/m1-walking-skeleton",
    builds: [
      "Add a Git repository and start a real <code>claude --bg</code> session in its own worktree, with a live terminal",
      "Quit or kill the app mid-turn, reopen it, and find state, events and the terminal as they were",
      "A hook blocks every PR create or merge; outside the worktree only one exclude line changes"
    ],
    counts: { tasks: 17, steps: 92, waves: 9, lanes: 4 },
    reviews: "Code review on every task · security review on 3, 4, 7, 10 · UI review on 13 to 15",
    needs: [
      {
        id: "D6",
        title: "Remove project is refused while it has sessions",
        why: "The spec is silent. Refusing keeps sessions from losing their project.",
        options: ["Keep as planned", "Allow it and stop the sessions first"],
        task: 8
      },
      {
        id: "D8",
        title: "A starting session shows “running” in the list",
        why: "The header says “Starting”. The spec has no extra state word.",
        options: ["Keep as planned", "Add the state word “starting”"],
        task: 11
      },
      {
        id: "D3",
        title: "Hook helper runs as the app itself in Node mode",
        why: "Fast and needs no extra runtime, but the Electron fuse RunAsNode stays on.",
        options: ["Keep as planned", "Use another runtime from check T6"],
        task: 4
      }
    ],
    info: [
      { title: "Tasks run in lanes from Task 3 on", why: "The plan text still says “strictly in order”. The decision of 2026-11-28 allows lanes; the lanes below follow each task’s Consumes line." },
      { title: "Both streams use WebSocket", why: "Token in the subprotocol, not in the URL." },
      { title: "API port 47620", why: "Falls back to a free port, written to api.json." },
      { title: "Worktrees use git worktree add --no-track", why: "A plain git push cannot reach the default branch." },
      { title: "Hook events keep only the fields the app needs", why: "Prompt text and tool input are never stored." },
      { title: "New packages are at least seven days old", why: "A fresh compromised release cannot slip in." }
    ],
    risks: [
      { text: "<code>claude agents --json</code> fails or prints non-JSON", expect: "Every session keeps its last state; the status bar says “Claude Code not reachable”", tasks: [11] },
      { text: "A path with a space or a non-ASCII letter", expect: "Hooks, status line, worktree and PTY still work", tasks: [4, 5] },
      { text: "You open the session in your own terminal with <code>claude attach</code>", expect: "The app shows “Opened in another window” and never reattaches by itself", tasks: [10] },
      { text: "A remote URL that carries credentials", expect: "The secret never reaches a file, the log, the UI or a log line", tasks: [5, 7] },
      { text: "Hook helpers append to the spool while the app imports it", expect: "No event lost, none imported twice, no torn line", tasks: [4] }
    ],
    stopRule: "If check T1 shows that no setting keeps a session in its worktree, the plan stops after Task 1 and you decide.",
    // A lane is one worktree stream; tasks in one wave run at the same time,
    // one per lane. Derived from each task's Consumes line.
    lanes: [
      { id: "l1", name: "Lane 1 · core" },
      { id: "l2", name: "Lane 2 · git" },
      { id: "l3", name: "Lane 3 · CLI" },
      { id: "l4", name: "Lane 4 · fake CLI" }
    ],
    tasks: [
      { n: 1, title: "Checks T1 to T6 against the real CLI", lane: "l1", wave: 1, steps: 8, needs: [], agent: "implementer · Opus high", review: "spec", does: "Six short tests against Claude Code 2.1.332 before any code depends on them. No product code.", files: ["spikes/m1-claude-code/checks/t1-isolation.mjs", "… t2 to t6", "docs/spikes/2026-11-27-m1-claude-code-internals.md"], stepNames: ["T1 worktree isolation", "T2 trust", "T3 no first prompt", "T4 app kill", "T5 deny rule", "T6 helper timing", "Write the results", "Commit"] },
      { n: 2, title: "Data folder, event log, projections, logged actions", lane: "l1", wave: 2, steps: 5, needs: [], agent: "implementer · Opus medium", review: "spec · code", does: "SQLite store with an append-only event log, projections and idempotent actions.", files: ["src/main/data-folder.ts", "src/main/store/event-log.ts", "src/main/store/actions.ts"] },
      { n: 3, title: "Local API, token, streams, preload, client", lane: "l1", wave: 3, steps: 6, needs: [2], agent: "implementer · Opus medium", review: "spec · code · security", does: "HTTP and WebSocket server on 127.0.0.1 with a token; the renderer is only a client.", files: ["src/main/api/server.ts", "src/main/api/auth.ts", "src/renderer/api/client.ts"] },
      { n: 4, title: "Hook helper, launcher and spool", lane: "l1", wave: 4, steps: 6, needs: [2, 3], agent: "implementer · Opus medium", review: "spec · code · security", does: "A helper that posts hook events to the app, or appends them to a spool file when the app is closed.", files: ["src/hook-helper/index.ts", "src/main/hooks/launcher.ts", "src/main/spool/import.ts"] },
      { n: 5, title: "Git layer: detection, task names, worktrees", lane: "l2", wave: 2, steps: 5, needs: [], agent: "implementer · Opus medium", review: "spec · code", does: "Detect the project, strip credentials from remotes, create and remove worktrees.", files: ["src/main/git/repo-info.ts", "src/main/git/remote-url.ts", "src/main/git/worktrees.ts"] },
      { n: 6, title: "Claude CLI access, trust, agents --json", lane: "l3", wave: 2, steps: 5, needs: [], agent: "implementer · Opus medium", review: "spec · code", does: "Find and run claude, read its version and the one trust value, parse agents --json.", files: ["src/main/claude/cli.ts", "src/main/claude/trust.ts", "src/main/claude/agents.ts"] },
      { n: 7, title: "Base setup: settings, PR block, workflow instruction", lane: "l1", wave: 5, steps: 6, needs: [2, 4, 5], agent: "implementer · Opus medium", review: "spec · code · security", does: "Per-session settings from outside the repo, the PR block hook and the versioned workflow instruction.", files: ["building-blocks/workflow-instruction.md", "src/main/base-setup/settings.ts", "src/shared/pr-block.ts"] },
      { n: 8, title: "Projects: config, detection, setup check, routes", lane: "l2", wave: 4, steps: 5, needs: [2, 3, 5, 6], agent: "implementer · Opus medium", review: "spec · code", does: "project.json, the read-only setup check and the project routes.", files: ["src/main/projects/project-config.ts", "setup-check.ts", "project-service.ts"] },
      { n: 9, title: "Fake claude CLI for tests and CI", lane: "l4", wave: 2, steps: 5, needs: [], agent: "implementer · Opus medium", review: "spec · code", does: "Answers --version, --bg, agents --json, attach and stop from scripted scenarios.", files: ["tooling/fake-claude/cli.mjs", "worker.mjs", "scenarios/basic.json"] },
      { n: 10, title: "Background adapter, attach terminals, terminal stream", lane: "l3", wave: 4, steps: 5, needs: [3, 6, 9], agent: "implementer · Opus medium", review: "spec · code · security", does: "The AgentAdapter for claude --bg with one app-owned attach PTY per session.", files: ["src/main/adapter/agent-adapter.ts", "background-adapter.ts", "attach-terminal.ts"] },
      { n: 11, title: "Session state rules, tracker, poller", lane: "l3", wave: 5, steps: 5, needs: [2, 3, 4, 6], agent: "implementer · Opus medium", review: "spec · code", does: "One state word per session from agents --json, hooks and the status line, within 2 s.", files: ["src/main/sessions/state-rules.ts", "state-tracker.ts", "agents-poller.ts"] },
      { n: 12, title: "Session service, routes, restart sequence", lane: "l1", wave: 6, steps: 5, needs: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], agent: "implementer · Opus medium", review: "spec · code", does: "Start, open, stop and remove as logged actions; the sequence that restores state on start.", files: ["src/main/sessions/session-service.ts", "src/main/startup.ts"] },
      { n: 13, title: "App shell: title bar, session list, status bar", lane: "l1", wave: 7, steps: 6, needs: [3, 8, 12], agent: "implementer · Opus medium", review: "spec · code · UI", does: "The first Lagoon screens, with empty states and the project menu.", files: ["src/renderer/components/TitleBar.tsx", "SessionList.tsx", "StatusBar.tsx"] },
      { n: 14, title: "Session header and terminal view", lane: "l2", wave: 7, steps: 6, needs: [10, 12], agent: "implementer · Opus medium", review: "spec · code · UI", does: "Header with state and actions, xterm view of the live session.", files: ["src/renderer/components/SessionHeader.tsx", "TerminalView.tsx"] },
      { n: 15, title: "Add-project and new-session dialogs", lane: "l3", wave: 7, steps: 6, needs: [3, 5, 8, 10, 12], agent: "implementer · Opus medium", review: "spec · code · UI", does: "Add a repository with the setup checklist and trust step; start a session.", files: ["src/renderer/components/AddProjectDialog.tsx", "SetupChecklist.tsx", "NewSessionDialog.tsx"] },
      { n: 16, title: "End-to-end walking skeleton against the fake CLI", lane: "l1", wave: 8, steps: 4, needs: [13, 14, 15], agent: "implementer · Opus medium", review: "spec · code", does: "Playwright runs the whole flow in CI: add, start, quit, reopen, remove.", files: ["e2e/walking-skeleton.spec.ts", "e2e/fixtures/demo-repo.ts"] },
      { n: 17, title: "Manual real-CLI check and progress", lane: "l1", wave: 9, steps: 4, needs: [16], agent: "lead with you · Sonnet medium for docs", review: "final review of the whole branch", does: "The same flow once by hand against the real CLI, recorded in docs/progress.md.", files: ["docs/progress.md", "README.md"] }
    ],
    short: { 1: "CLI checks", 2: "Event store", 3: "Local API", 4: "Hook helper", 5: "Git layer", 6: "Claude CLI", 7: "Base setup", 8: "Projects", 9: "Fake CLI", 10: "Adapter", 11: "State rules", 12: "Sessions", 13: "App shell", 14: "Terminal", 15: "Dialogs", 16: "e2e test", 17: "Manual check" },
    // Demo state for screen 2 (plan running). Not the real state of M1.
    progress: { 1: 8, 2: 5, 3: 6, 4: 6, 5: 5, 6: 5, 7: 3, 8: 5, 9: 5, 10: 5, 11: 2 },
    running: [7, 11]
  },

  spec: {
    kind: "Spec",
    title: "M1 walking skeleton",
    source: "docs/specs/2026-11-27-m1-walking-skeleton-design.md",
    sha256: "d229f91b77274f1398177ecfbc3f5607e63e9e2592e7bce680114068bebafc05",
    template: "review-page/spec 0.1.0",
    written: "2026-11-27 14:05",
    intent: "The first Orchtopus that does the real thing end to end, in its simplest form: add a project, start a real Claude Code session in its own worktree, watch it work, close the app, open it again, and find everything as it was.",
    doneWhen: [
      "Add a Git repository through a dialog; the setup check lists results with a fix per finding",
      "Start a session with a task name; worktree on a new branch; <code>claude --bg</code>; live terminal",
      "State word and lamp in the list, changes within 2 s",
      "Quit or kill mid-turn; the session keeps running; on reopen state, events and terminal are back",
      "A PR or MR create or merge is blocked by a hook",
      "Outside the worktree only one exclude line and worktree metadata change",
      "End-to-end test against a fake CLI in CI; one manual run against the real CLI"
    ],
    notInM1: "Decision cards and the inbox (M2) · gates, spec and plan views (M3) · PR drafts (M4) · settings, themes, octopus (M6)",
    needs: [
      { id: "L2", title: "The PR block is already in M1", why: "Background sessions open draft PRs on their own by default.", options: ["Keep", "Move to M2"] },
      { id: "L7", title: "When Orchtopus is gone, the hook launcher allows", why: "Sessions never get stuck, but the PR block is off while the app is missing.", options: ["Keep", "Block instead"] },
      { id: "L3", title: "Remove session never deletes the branch", why: "It stops the session and removes a clean worktree only.", options: ["Keep", "Offer to delete the branch"] }
    ],
    info: [
      { title: "One API token per installation", why: "Renewable through an API route; the button comes with settings in M6." },
      { title: "A finished turn is “idle”", why: "“Done” is kept for a finished task (M4)." },
      { title: "Model, effort and mode per session", why: "The dialog remembers the last values per project." },
      { title: "Trust is read from one value of ~/.claude.json", why: "Read only. If that fails, the state is “unknown” and the trust step is offered." },
      { title: "If T1 fails, the plan stops and you decide", why: "No setting would keep sessions in Orchtopus’ worktree." }
    ],
    approaches: [
      { id: "A", name: "Everything in the Electron main process", tradeoff: "Simplest. Hook events while the app is closed are lost.", chosen: false },
      { id: "B", name: "A separate service that starts with Windows", tradeoff: "No event lost, but a second process; M1 grows by about a third.", chosen: false },
      { id: "C", name: "Like A, plus a spool file", tradeoff: "No event lost, one process. M2 needs the spool anyway.", chosen: true }
    ],
    checks: [
      ["T1", "Does a setting keep a --bg session in the given worktree?", "Plan stops; you decide"],
      ["T2", "Is trust inherited by the worktree?", "Trust step per worktree"],
      ["T3", "Does --bg start without a first prompt?", "First prompt required"],
      ["T4", "Do sessions survive quitting or killing the app?", "Start detached"],
      ["T5", "Does a deny rule block the SSH folder?", "Absolute path form"],
      ["T6", "Is the hook helper fast enough on Windows?", "Another runtime"]
    ]
  },

  sessions: [
    { project: "orchtopus", items: [
      { name: "m1-walking-skeleton", word: "Plan waits", signal: "plan", progress: "plan" },
      { name: "upload-fix", word: "Running", signal: "running", progress: "4 of 7" }
    ] },
    { project: "acme-app", items: [
      { name: "report-export", word: "Running", signal: "running", progress: "12 of 15" },
      { name: "image-resize", word: "PR draft", signal: "done", progress: "done" }
    ] },
    { project: "docs-site", items: [
      { name: "changelog", word: "Idle", signal: "idle", progress: "3 of 3" }
    ] }
  ]
};
