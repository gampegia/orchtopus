# Progress

Last update: 2026-11-27 (M0 built on branch `feat/m0-tooling`, lead: Fable)

## Done

- Handover pack read in full (concept, implementation guide, templates, mockups, prototype).
- Repository created locally with `main`. Handover pack copied to `docs/handover/`, renamed from the working title to Orchtopus, concept translated to English (`docs/handover/docs/concept.md`).
- `CLAUDE.md`, agents in `.claude/agents/`, `.gitignore`, `LICENSE` (MIT), `README.md`.
- Skills: unslop installed at project scope (`.claude/settings.json`), `pick-ui-library` installed to `.claude/skills/`. superpowers and i-have-adhd already exist at user scope.
- Claude Code internals checked against the current docs (see below).

### M0 tooling (2026-11-27, merged through the pull request of branch `feat/m0-tooling`)

- Scripts: `dev`, `build`, `start`, `check`, `lint`, `format`, `typecheck`, `test`, `e2e`, `smoke:native`, `package`, `audit`. See `CLAUDE.md`, section "Commands".
- CI on `windows-latest` (`npm ci`, `check`, `smoke:native`, `e2e`, `audit`) plus a gitleaks scan.
- Security defaults for the Electron window, covered by unit tests and by 10 e2e tests. The e2e suite also passed against the packaged app in `release/win-unpacked/`.
- Design tokens are built into CSS by a Vite plugin. 114 unit tests.
- Unsigned directory build with `npm run package`.
- Final review: code, security, spec, UI and privacy reviewers on the whole branch, one fix wave (`ee061de` to `fcdd9ea`), re-review approved with no blocking finding.
- The repository has a local git identity with the GitHub noreply address, so commits do not carry a personal e-mail.
- Left for later PRs (none blocks M0):
  - Check once by hand that a Vite full reload works in `npm run dev` (edit `index.html` or a `.tsx` file). `will-navigate` is denied for every navigation; if a reload is blocked, allow navigation to the current URL in unpackaged dev only.
  - `will-redirect` is denied for every load, and `loadRenderer` ignores `ERR_ABORTED`. A dev server or protocol handler that redirects would give a blank window. Allow redirects to the startup origin or log ignored aborts.
  - Pass the parsed URL (`new URL(value).href`) to `loadURL`, so the checked and the loaded value are the same.
  - CI: a pending run on `main` can still be replaced by a newer one; give `main` runs their own concurrency group. Correct the comment in `ci.yml`.
  - Custom `app://` protocol instead of `file://`, before M1 grows the renderer (CSP `self` under `file://` is broad).
  - Electron fuses, before any release milestone.
  - `npm` `allowScripts` policy. npm 11 skips the install scripts of node-pty and better-sqlite3; the prebuilds load and `smoke:native` guards it in CI.
  - Packaged build e2e in CI.
  - Refuse `url(`, `image-set(` and `!important` in token values, before themes can be loaded from user folders.
  - `Menu.setApplicationMenu(null)`, bundled Figtree and JetBrains Mono font files, a check for named CSS colours in renderer sources.
  - Document `ORCHTOPUS_BACKGROUND_WINDOW` in the README.

Agents for M0: implementers 10x Opus (medium) plus fix rounds, task reviews 10x Sonnet (medium), final reviews code and security Opus (high), spec, UI and privacy Sonnet, fix wave Opus (medium), re-review Opus (high), docs Sonnet. Lead: Fable. Tasks 7b to 10 and the final review ran as workflows.

### M0 versions

Exact pins in `package.json`. Source: the "Versions" table in `docs/plans/2026-11-27-m0-tooling.md`.

| Package | Version | Evidence |
|---|---|---|
| electron | 45.5.0 | Bundles Node 24.22.3, Chromium 156, ABI 150; the app and e2e run on it |
| electron-vite | 6.0.0 | Peer `vite ^6 \|\| ^7 \|\| ^8` |
| vite | 8.4.0 | Inside the electron-vite and vitest peer ranges |
| react, react-dom | 19.3.1 | react-dom peer `react ^19.3.1` |
| @types/react, @types/react-dom | 19.3.3, 19.3.0 | @types/react-dom peer `@types/react ^19.3.0` |
| typescript | 6.0.3 | typescript-eslint 8.74.0 has peer `typescript <6.1.0`; npm `latest` is 7.0.2 |
| eslint, @eslint/js | 10.15.0, 10.0.1 | npm `latest`, matching pair |
| typescript-eslint | 8.74.0 | Peer `eslint ^10` |
| eslint-plugin-react-hooks | 7.1.1 | Peer includes `eslint ^10` |
| eslint-config-prettier | 10.1.9 | Flat entry point `eslint-config-prettier/flat` |
| globals | 17.14.0 | npm `latest` |
| prettier | 3.10.1 | `lint` runs `prettier --check .` |
| vitest | 5.1.2 | 114 unit tests pass |
| @playwright/test | 1.65.1 | `_electron` is experimental; 10 e2e tests pass |
| node-pty | 1.1.0 | `smoke:native` PASS; ships win32-x64 prebuilds |
| better-sqlite3 | 13.2.0 | `smoke:native` PASS, sqlite 3.54.1; Node-API prebuilds inside the package |
| electron-builder | 26.18.0 | `npm run package` builds `release/win-unpacked/` |
| @types/node | 24.19.4 | Newest 24.x |

Not installed: `@electron/rebuild` 4.2.1 (not needed, fallback only) and `@vitejs/plugin-react` 6.3.0 (its Fast Refresh preamble is an inline script that the CSP blocks).

### SQLite binding

better-sqlite3 13.2.0: Node-API prebuilds for win32-x64, no compiler and no Electron rebuild needed, loads in Electron 45.5.0 (Node 24.22.3, modules 150) (smoke:native PASS, sqlite 3.54.1). `node:sqlite` in Electron 45: available, sqlite 3.54.1 (INFO line from smoke:native). node-pty 1.1.0 also PASS.

Agents used in session 1: mockup and prototype analysis 2× Sonnet; concept translation 4× Sonnet (medium); Claude Code research 2× claude-code-guide; install command check 1× web-fetch; privacy review 1× Sonnet (high).

## Next

**M1 is next.** M0 is done. Spec: `docs/specs/2026-11-27-m0-tooling-design.md`. Plan: `docs/plans/2026-11-27-m0-tooling.md`.

Before M1 code: go through "Left for later PRs" under the M0 entry and do the small ones (dev reload check, redirect handling, CI concurrency) in one PR.

M1 starts with the spike on background sessions, hooks and status line on Windows (see the table of assumptions in the product spec, section 10). Start the next lead session with the folder `orchtopus` as working directory so the project agents in `.claude/agents/` load.

Known gap after M0: CI does not build or start the packaged app (`npm run package`); it is checked locally only. Add a packaged-app check to CI when an installer is introduced.

Backlog ideas live in `docs/backlog.md` (first entry: Logitech MX Master 4 integration).

Step 3 is done: the product design spec is merged (`docs/specs/2026-11-26-orchtopus-product-design.md`).

Step 4 is done: the user chose the direction **Lagoon** (round 2, variant B) with the octopus from variant A and the "Then" strip from variant C. `DESIGN.md` holds direction, tokens, components, motion rules and theme structure. Reference mockup: `docs/design/reference/lagoon.html`, tokens: `docs/design/reference/lagoon.tokens.json`. All explorations stay in `docs/design/explorations/` (open `index.html` and `round-2.html` through a local web server, because the pages embed the mockups in frames).

UI libraries chosen with the user: base-ui, cmdk, Sonner, zustand, shiki, plain CSS with CSS variables, react-resizable-panels; later as needed Virtuoso, dnd kit, recharts, motion.

Agents for step 4: 8x Opus (high) for round 1, 3x Opus (high) for round 2, 1x Opus (high) for the reference mockup and `DESIGN.md`, reviews by Opus (spec) and Sonnet (UI and privacy).

## Decisions by the user (session 1)

- Name: Orchtopus. "Orch"-style naming is welcome where it fits, also for the pixel-art pet.
- Public repo on GitHub under the user's account. Everything in the repo is English.
- The human gate at the end is "release PR", not merge (E24 overrides G10 and F17).
- Nothing in the user's project repositories if avoidable. Storage location should be selectable.
- GitLab is required (available on another machine of the user, not on this one).
- Mockups in the pack are inspiration. More and more varied design explorations are wanted, made with the design skills, realistic for the workflow.
- Since 2026-11-27 the lead merges every PR of this repository itself after a review by a suitable agent with no open blocking findings.
- The octopus is an animated, customisable character with styles and accessories; interactions get a motion pass.
- Messages to the user end with a clear line: what is needed from the user, or that it is for information only.

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

- Session lifecycle, side chat and enforcement follow the spec; the M1 spike verifies the items marked *test*.
- Local API token: per app start or per installation.

## Gotchas

- Anthropic's Agent SDK terms do not allow third-party products to offer claude.ai login. Orchtopus therefore drives the user's own installed `claude` CLI and never handles the login itself. Keep it that way and do not switch to the SDK without an API key.
- Transcript JSONL files and `~/.claude/jobs/` are internal formats. Do not parse them.
- Some hook features need a newer Claude Code than 2.1.292 (`onFailure` from 2.1.295). Check the installed version at app start.
- `glab` is not installed on this machine. GitLab code needs tests against recorded CLI output and a manual check on the user's other machine.
- The prototype has no flows for command palette, context and usage display, or crash recovery.
- TypeScript is held at 6.0.x until typescript-eslint supports 7 (peer `<6.1.0`).
- No `@vitejs/plugin-react`: Fast Refresh needs an inline script that the CSP blocks. Do not add it without a CSP plan.
- CSS for the renderer is linked from `index.html`, not imported from TS. CSS imported from JS is injected as `<style>` in dev and blocked by the CSP.
- The sandboxed preload must stay CommonJS. Do not add `"type": "module"` to `package.json` without forcing the preload format.
- `ELECTRON_RUN_AS_NODE` in the environment breaks `npm run dev` and `smoke:native`.
- The Vitest config is `vitest.config.mts`. `package.json` has no `"type"` field, and Vite warns for a `.ts` config.
- `.gitattributes` forces LF. Without it, Windows CI fails Prettier and the workflow regex tests.
- e2e launches pass `colorScheme: null`. Playwright otherwise forces the light colour scheme and the dark-mode test cannot pass.
- `getLastWebPreferences` is missing from the Electron 45 types. e2e uses it through a type-only cast. Re-check it on an Electron upgrade.
- `ORCHTOPUS_BACKGROUND_WINDOW=1` makes the app show its window without taking focus. The e2e suite sets it.
- npm 11 skips the install scripts of node-pty and better-sqlite3 (allowScripts gate). The bundled prebuilds load without them.
- `npm audit` reports 6 moderate advisories (minimatch through electron-builder), none high. Upgrade in its own PR.
- A red check that launches a broken package shows an Electron error dialog on the desktop.
- Known gap: CI does not run `npm run package`.
- In three handover themes the decision card chrome is hard-coded amber, also for the danger and PR cards. Do not copy that.
