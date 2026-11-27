# Design exploration brief

Orchtopus is a Windows desktop app that runs and supervises several Claude Code sessions. One person uses it all day. Their problem today: jumping between terminal windows to see whether every session is still running, whether one needs a permission, whether one is stalled. Orchtopus must answer three questions in three seconds, without a click: what is each session doing, what comes next, where am I needed.

Each exploration is one design direction for the same four screens with the same content. The directions differ on purpose in style, density and layout. The user compares them and picks one.

## Rules for every direction

1. **Same content.** Use the screens and demo data below. Wording of labels may be tightened, facts may not change. Layout is free: where the session list sits, how decisions appear, how much is visible at once.
2. **The session list is always visible** on the session screens, with a state word per session. The session view is the home screen.
3. **Signal colours keep their meaning and always carry a text label:** amber = permission, violet = spec or plan, green = PR or done, red = danger or stalled, orange = overlap, blue = running. A direction may shift hue and lightness, never the meaning. Colour is used for signals; the rest of the interface stays neutral.
4. **Text contrast at least WCAG AA** in light and dark. The terminal and decision cards are opaque or nearly opaque in every direction.
5. **Dangerous commands** have exactly one way to allow them: a button "Hold to allow once" (press for one second). No "always allow". Show the hint "Not available by hotkey or remote".
6. **English UI text.** Sentence case. Monospace only for commands, paths and terminal output. Result or next action first, short sentences.
7. **Only generic demo names:** `acme-app`, `acme-web`, `docs-site`, `report-export`, `upload-fix`, `image-resize`, `i18n-de`, `changelog`. No real names, no real paths.
8. **Realistic.** This is a tool for long working days. It must be buildable with React and CSS variables in Electron, readable at 100 % zoom, and calm under load. No decoration that costs attention without carrying information.
9. **Follow the unslop skill:** find the direction from the product, then run its passes in order (spacing, colour, icons, copy, type, layout, details, visuals, motion) and its checklist. No purple gradients, glows without meaning, gradient text, emoji labels, uppercase tracked labels, nested cards or uniform card grids.

## File contract

- One self-contained file per direction: `docs/design/explorations/<nn>-<slug>.html`. No build step, no frameworks, no external scripts or images. Fonts: system font stacks, or Google Fonts through a `<link>`.
- The file renders a desktop window of 1440 × 900 px (scaled down if the viewport is smaller) and shows one screen at a time.
- A small, unobtrusive control bar outside the window frame switches screen (1 to 4) and mode (light, dark). Keys `1`–`4` switch screens, `D` toggles the mode.
- State is read from and written to the URL hash: `#screen=1&mode=dark` (screen 1–4, mode `light` or `dark`). Default: screen 1, dark. This lets a comparison page deep-link into every state.
- All colours, radii, spacing and fonts are CSS custom properties on the root, with one set for light and one for dark. Components reference only those properties.
- Icons: inline SVG, one consistent set (Lucide-style strokes are fine). No emoji.
- Small interactions that explain the design may be scripted (hold-to-allow progress, tab switch). Nothing has to work for real.

## Demo data

**Projects and sessions (sidebar or equivalent)**

| Project | Session | Branch | State | Progress |
|---|---|---|---|---|
| acme-app | report-export | feat/report-export | needs you (permission) on screen 1; ready for review on screen 3 | task 12 of 15 |
| acme-app | upload-fix | fix/upload | running | task 4 of 7 |
| acme-app | image-resize | feat/image-resize | PR draft waiting | done |
| acme-app | i18n-de | chore/i18n-de | running on screen 1; danger on screen 2 | task 2 of 6 |
| docs-site | changelog | docs/changelog | idle | 3 of 3 |

Status line somewhere quiet: Claude Code connected · 5 sessions · Git updated 3 s ago. Inbox count: 2.

## Screen 1: session with a permission request

Selected session: report-export.

- Session header: name, branch `feat/report-export`, state. Actions: Pause, open in Explorer, VS Code, Terminal.
- Hint that another session also waits: image-resize, PR draft.
- **Permission card (amber):**
  - Title: Bash command needs permission. Waiting 1 min; falls back to the terminal prompt in 9 min.
  - Command: `npm install csv-parse@5.6.0 --save`
  - What it does: Downloads csv-parse 5.6.0 from the npm registry and adds it to package.json. The package can run install scripts. Only this worktree is affected.
  - Facts: network · changes package.json · install scripts
  - Actions: Allow once (primary), Always allow in this project, Deny, Ask the advisor.
- **Terminal** of the real session, a few plausible lines (a skill call, a subagent, a Bash line), ending with: waiting for permission.
- Progress: task 12 of 15, "Normalise date ranges". Workflow phases: Brainstorm, Spec, Plan done; Execute running; Review, Finish open.
- Session info: subagents 1 active; Git 5 ahead, 0 behind `develop`; context 41 % used.
- Side chat (read-only helper for this session) with an input "Ask about this session".
- Optional: the pixel octopus pet, small, near the input.

## Screen 2: dangerous command

Selected session: i18n-de.

- **Danger card (red):**
  - Title: Dangerous command.
  - Command: `git push --force origin chore/i18n-de`
  - What it does: Replaces the remote branch with your local one. Commits that exist only on the remote are lost. `main` and `develop` are not touched.
  - Facts: force push · rewrites remote branch
  - Actions: Hold to allow once (press 1 s), Deny, Ask the advisor. Hint: Not available by hotkey or remote.
- Terminal ending with: waiting for permission, dangerous command.
- The rest as on screen 1, for session i18n-de (task 2 of 6).

## Screen 3: review detail with PR draft

Session: report-export, `feat/report-export → develop`. Back and close controls.

- **What was done:** 15 of 15 tasks (show a readable list or summary, not 15 identical tiles). Links: Diff (3 files), Session history, Open worktree in VS Code.
- **Gates:** Spec approved (you) · Plan approved (you) · Tests 60 passed · Lint and types passed · Secret scan passed · Dependency audit passed · Review council 4 of 4 · Git check 1 note · Release PR (you, open) · CI (after PR).
- **Review council:** spec compliance pass; code quality pass, 2 notes for the checklist; tests pass; security not needed (no sensitive paths).
- **Git check:** branch name ok, commits ok, target `develop` ok, note: this PR mixes two topics, consider splitting. Action: Ask the advisor to draft a split.
- **PR draft (green), not created yet:**
  - Title: `feat(export): export reports with date filters`
  - Target branch: develop. Checkbox: Draft PR.
  - Description (editable, written by Claude) with sections What, Why, Tests, Checklist.
  - Actions: Release and create PR (primary), Regenerate description, Copy.
  - Note: Orchtopus never merges. You merge on GitHub or GitLab.
- **Advisor** for this change: two short exchanges, an input "Ask, or write an instruction", and a way to hand an instruction to the session ("Send to session").

## Screen 4: settings

Global settings; per-project overrides are marked.

- Navigation: General, Appearance (selected), Models, Usage, Notifications, Keyboard, Privacy, Projects.
- **Appearance:** mode Light / Dark / Like Windows; design variant picker with small previews (at least three variants, the current one selected); note that changes apply instantly.
- **Usage:** subscription limits. 5-hour window 46 %, resets 16:40. Weekly 31 %, resets Mon 09:00. Pause background jobs at 70 %. Ask before new sessions at 90 %.
- **Models per role** (model · effort): Main session Opus · high; Planning Opus · high; Review council Sonnet · medium; Security reviewer Opus · high; Advisor and side chat Sonnet · medium; Wiki Sonnet · medium; Summaries Haiku · low.

## What to hand back

A short report: file path, the direction in five lines (product, character, world, highlights, signature), fonts used, anything in the unslop checklist the direction breaks on purpose and why, and known weak spots.
