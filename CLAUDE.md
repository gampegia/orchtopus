# Orchtopus

Windows desktop app (Electron, TypeScript) that runs and supervises several Claude Code sessions across projects with a gated workflow.

- Requirements: `docs/handover/docs/concept.md` (translated from the German original; newer decisions override older text: higher E numbers and newer changelog rows win).
- Build plan and milestones M0–M8: `docs/handover/docs/IMPLEMENTATION-GUIDE.md`.
- Specs: `docs/specs/`. Plans: `docs/plans/`. Design direction: `DESIGN.md` (created after the design exploration).
- Progress: `docs/progress.md`. A new session starts there.

## Language
- Talk to the user in German. Messages follow the text style in the concept (E32): result or next action first, short sentences, numbered steps, no filler.
- Everything in the repo is English: code, comments (inline, headers, docstrings), commit messages, UI text, docs.

## Workflow
- superpowers for every milestone: brainstorming → spec → writing-plans → subagent-driven-development (TDD, worktrees, two-stage review) → review by the agents → finish as a PR.
- The user approves spec and plan. Never push to `main` directly; every change goes through a PR.
- The lead merges a PR itself after a review by a suitable review agent has no open blocking findings (user decision, 2026-11-27). The privacy review still runs before every push. This is about this repository; the product rule that Orchtopus never merges the user's project PRs is unchanged.
- Conventional Commits. Small commits.
- Parallel implementation work only after the walking skeleton (M1) exists. The design step and M0 are the exception.
- Before building on Claude Code internals (hooks, status line fields, resume, background sessions, agent teams), check the current documentation and the installed version, and tell the user what you found.
- At the end of each session the lead updates `docs/progress.md`: done, next, open decisions, gotchas.

## Lead and agents
The lead plans, decides, dispatches, reviews and talks to the user. It does not write large amounts of code and keeps its own context lean. Agents live in `.claude/agents/`.

| Work | Model | Effort |
|---|---|---|
| Architecture, planning, security, hard bugs | Opus | high |
| Implementation (`implementer`) | Opus | medium to high |
| Critical reviews (`code-reviewer`, `security-reviewer`) | Opus | high |
| Checklist reviews (`spec-reviewer`, `ui-reviewer`, `privacy-reviewer`) | Sonnet | medium to high |
| Mechanical work (rename, move, format) | Sonnet | low |
| Summaries of logs and similar | Haiku | low |

Note at each milestone which agents ran with which model and effort.

## Architecture rules
- The UI talks to Claude Code only through the `AgentAdapter` interface. First adapter: terminal (PTY), official Claude Code hooks, status line.
- Every user action goes through the local API (127.0.0.1, token); state changes are events that clients can subscribe to.
- Decisions are logged before they run; actions are idempotent (crash recovery).
- Components use design tokens only (no hard-coded colours, spacing or fonts). Themes live in `themes/<name>/`.
- Prompts, skills, session types, wiki template, text style, keymap and secret rules are files with a version, loaded at runtime.
- No limits that are not needed: show load and usage, warn, do not cap by default.
- Orchtopus writes nothing into the user's project repositories by default. Project config, wikis, histories, learnings and usage live in the Orchtopus data folder (default `%APPDATA%\Orchtopus\`, location configurable).
- Git providers: GitHub (`gh`) and GitLab (`glab`) behind one provider interface. Both are required.
- Out of scope for now: hardware pad, smartwatch, bridge mod. Keep the API open for them.

## Privacy
- Public repo. Only generic demo names in code, tests, fixtures, screenshots and docs: `acme-app`, `acme-web`, `report-export`, `upload-fix`, `image-resize`, `i18n-de`, `docs-site`, `changelog`.
- No real project, company or person names, no secrets, no private paths.
- The `privacy-reviewer` agent checks every diff before a push.

## UI
- The mockups in `docs/handover/mockups/` are inspiration, not a specification. The design is chosen from explorations in `docs/design/explorations/` and then recorded in `DESIGN.md`.
- Run the unslop design skill on every new or changed screen and follow its checklist.
- Signal colours keep their meaning and always carry a text label: amber permission, violet spec or plan, green PR or done, red danger or stalled, orange overlap, blue running.
- Dangerous commands can only be allowed by holding the button in the app. Never by hotkey, pad or watch.

## Commands
Fill in during M0: install, dev, test, lint, typecheck, e2e, build.
