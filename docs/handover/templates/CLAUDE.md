# Orchtopus

Windows desktop app (Electron, TypeScript) that runs and supervises several Claude Code sessions across projects with a gated workflow. Requirements: `docs/handover/docs/concept.md`. Build plan: `docs/handover/docs/IMPLEMENTATION-GUIDE.md`. Progress: `docs/progress.md`.

## Language
- Talk to the user in German.
- Everything in the repo is English: code, comments (inline, headers, docstrings), commit messages, UI text, docs.

## Workflow
- superpowers for every milestone: brainstorming → writing-plans → subagent-driven-development (TDD, worktrees, two-stage review) → finish as a PR.
- The user approves spec and plan. Never merge; never push to `main`.
- Conventional Commits. Small commits.
- Delegate to the agents in `.claude/agents/`. The lead keeps its context lean and updates `docs/progress.md` at session end.

## Architecture rules
- UI talks to Claude Code only through the `AgentAdapter` interface.
- Every user action goes through the local API (127.0.0.1, per-start token); state changes are events.
- Decisions are logged before they run; actions are idempotent (crash recovery).
- Components use design tokens only (no hard-coded colours, spacing or fonts). Themes live in `themes/<name>/`.
- Prompts, skills, session types, wiki template, text style, keymap, secret rules are files with a version, loaded at runtime.
- No limits that are not needed: show load and usage, warn, do not cap by default.
- Out of scope for now: hardware pad, smartwatch, bridge mod. Keep the API open for them.

## Privacy
- Public repo. Only generic demo names (`acme-app`, `report-export`, `upload-fix`) in code, tests, fixtures, screenshots and docs.
- Project data (config, wikis, histories, learnings, usage) lives in the user folder, never in the repo.
- The privacy-reviewer agent checks every diff before a push.

## UI
- Run the unslop design skill on every new or changed screen; follow its checklist.
- Signal colours always with a text label: amber permission, violet spec/plan, green PR/done, red danger, orange overlap, blue running.
- Visual reference: `docs/handover/mockups/` (Island Landscape and Tinted Glass preferred, Stellwerk default).

## Commands
Fill in during M0: install, dev, test, lint, typecheck, e2e, build.
