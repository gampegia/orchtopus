# Orchtopus

Orchtopus is a Windows desktop app that runs and supervises several [Claude Code](https://code.claude.com/docs) sessions across your projects. It shows what each session is doing, collects everything that needs you in one inbox, and holds the work at gates: spec, plan, tests, review, pull request.

> **Status: early development.** The app opens an empty window; no feature works yet.

## Why

Running many coding agents in parallel is easy. Knowing which one needs you, and keeping the quality of their work up, is not. Orchtopus answers three questions quickly:

1. What is each session working on?
2. What comes next?
3. Where do I have to step in?

## Planned features

- **Sessions in real terminals.** Each task runs the real `claude` CLI in its own Git worktree, with your normal login.
- **One inbox for everything that needs you.** Permission requests, spec and plan approvals, stalled sessions, failed pipelines.
- **Permission cards with an explanation.** What the command does, its risks, allow once or deny. Dangerous commands need a deliberate hold in the app.
- **Gated workflow.** Spec → plan → test-driven implementation → automatic checks → review council → pull request. Built on [superpowers](https://github.com/obra/superpowers).
- **Review and pull requests.** Review detail with gates, findings, diff and a drafted PR or MR. Orchtopus never merges; you release the draft and merge on GitHub or GitLab.
- **Advisor and side chat.** Ask questions about a session without interrupting it. Nothing reaches a session without your click.
- **Robust by design.** State on disk, decisions logged before they run, sessions that survive an app restart.
- **Usage in view.** Context fill per session, plan limits, model and effort per role.
- **Themes from design tokens.** Light and dark, several design variants, a new theme is a new folder.
- **Project wiki.** A generated, fact-checked summary of each project, kept outside the project repository.

Hardware pads, smartwatch apps and a Claude Code bridge mod are out of scope for now. The architecture stays open for them: every action goes through a local API.

## Screenshots

Screenshots follow with the first milestones. The early design mockups are in [`docs/handover/mockups/`](docs/handover/mockups/index.html). They are inspiration, not the final design.

## Requirements

- Windows 10 or 11 (x64)
- [Claude Code](https://code.claude.com/docs) with an active login
- Git
- [GitHub CLI](https://cli.github.com/) (`gh`) and/or [GitLab CLI](https://gitlab.com/gitlab-org/cli) (`glab`), signed in
- For development: Node.js 24 or newer

## Documentation

| Document | Content |
|---|---|
| [`docs/handover/docs/concept.md`](docs/handover/docs/concept.md) | Concept and requirements (decisions E, requirements F) |
| [`docs/handover/docs/IMPLEMENTATION-GUIDE.md`](docs/handover/docs/IMPLEMENTATION-GUIDE.md) | Stack, milestones M0–M8, how the build is run with agents |
| [`docs/progress.md`](docs/progress.md) | Current state and next steps |
| [`CLAUDE.md`](CLAUDE.md) | Rules for Claude Code sessions that work on this repository |

## Development

Orchtopus is built with Claude Code itself: a lead session plans and reviews, subagents implement with test-driven development in worktrees, and every change ends in a pull request.

### Set up and run

Requirements: Windows 10 or 11 (x64), Node.js 24, Git.

1. `npm ci`
2. `npm run dev` opens the app with reload.
3. `npm run check` runs lint, type check, unit tests and the build. Run it before every pull request.
4. `npm run e2e` starts the built app with Playwright.

Other scripts: `npm run smoke:native` (native modules load in Electron), `npm run audit`, `npm run package` (unsigned build in `release/win-unpacked/`). CI runs the same scripts on Windows for every pull request.

Native modules (`node-pty`, `better-sqlite3`) ship prebuilt Node-API binaries for Windows x64, so no compiler is needed. If `npm ci` starts compiling them, install the Visual Studio C++ build tools with the Spectre-mitigated libraries.

This is a public repository. Code, tests, fixtures and docs use generic demo names only (`acme-app`, `report-export`, …). Orchtopus keeps all project data in your user folder, never in a repository.

## Licence

[MIT](LICENSE)

## Acknowledgements

Orchtopus uses or builds on these projects:

| Project | Use | Licence |
|---|---|---|
| [superpowers](https://github.com/obra/superpowers) by Jesse Vincent | Development workflow: brainstorming, plans, subagent-driven development, TDD, reviews | MIT |
| [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky ([@heydamir](https://github.com/heydamir)) | Design pass and checklist for every screen | CC BY 4.0 |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) by Emil Kowalski | `pick-ui-library` skill for choosing UI libraries | MIT |
| [i-have-adhd](https://github.com/ayghri/i-have-adhd) | Output style rules for texts to the user | MIT |
| [xterm.js](https://github.com/xtermjs/xterm.js), [node-pty](https://github.com/microsoft/node-pty) | Terminal in the app | MIT |
| [Lucide](https://lucide.dev) | Icons in the mockups | ISC |

The writing rules follow ASD-STE100 Simplified Technical English in spirit; the rules are paraphrased, not copied.
