# M0: repository tooling

Date: 2026-11-27
Status: approved by the user on 2026-11-27
Parent: `docs/specs/2026-11-26-orchtopus-product-design.md` (section 7, row M0)

## Intent

Lay the foundation so that every later milestone starts from a running app and an automatic safety net. M0 adds no product function.

## Done when

- `npm run dev` opens an Orchtopus window on Windows. It shows the product name on the Lagoon page colour, nothing else.
- `npm run check` runs lint, type check, unit tests and the build locally, with one command.
- `npm run e2e` starts the built app with Playwright and confirms that the window opens with the right title.
- CI on GitHub runs the same checks on Windows for every pull request and for `main`, plus a secret scan and a dependency audit.
- The native modules that M1 needs (`node-pty`, a SQLite binding) are proven to install and load inside Electron on Windows, locally and in CI.
- `CLAUDE.md` lists the commands; the README has a development section.

## Goals

- Electron app with electron-vite, TypeScript in strict mode, React for the renderer.
- Source layout: `src/main`, `src/preload`, `src/renderer`, `src/shared`.
- Security defaults from the first commit: context isolation on, sandbox on, no Node integration in the renderer, a preload that exposes nothing yet, a strict Content Security Policy, navigation and new windows denied, no remote content.
- Lint with ESLint (typescript-eslint, React hooks rules) and formatting with Prettier.
- Unit tests with Vitest; one real test for a small shared function, not a placeholder that always passes.
- End-to-end smoke test with Playwright for Electron.
- Design tokens: `themes/lagoon/tokens.json` is the source (taken from `docs/design/reference/lagoon.tokens.json`); a small build step turns it into CSS custom properties for light and dark. The window uses `surface.page` and `text.primary` from it. A unit test checks that every token exists in both modes; the `scene.*` tokens are the exception, because the scenery differs per mode by design (`DESIGN.md`, section 11).
- Native module smoke test: a script that loads `node-pty` and the SQLite binding in the Electron main process and exits with a clear result.
- Local unsigned build of the app as a directory (no installer).

## Non-goals

- Terminal, sessions, local API, state store, any real UI component.
- Installer, code signing, auto-update.
- UI libraries from `DESIGN.md` (base-ui and others). They are added when the first component needs them.
- A GitLab CI file. See "CI and Git providers".

## Anti-goals

- A check that passes without testing anything.
- CI that is green while the app cannot start.
- Security defaults that are switched off "for now".

## CI and Git providers

Two different things carry the word CI in this project:

1. **CI for the Orchtopus repository itself.** The repository lives on GitHub, so its CI is a GitHub Actions workflow. This is what M0 builds.
2. **Pipelines of the user's projects that Orchtopus shows** (GitHub and GitLab). That is product function and belongs to M4.

To keep the repository's own CI independent of the provider, every check is an npm script and the workflow only calls those scripts (`npm ci`, `npm run check`, `npm run e2e`, `npm run smoke:native`, `npm run audit`). A GitLab pipeline could call the same scripts later with a few lines. No GitLab CI file is added now, because it could not be tested without a GitLab copy of the repository and a Windows runner there, and an untested pipeline file gives false confidence.

## Approaches

| Approach | Trade-off | Decision |
|---|---|---|
| electron-vite | Small, one config for main, preload and renderer, fast reload | Chosen |
| Electron Forge with the Vite plugin | Packaging and publishing built in, but heavier and more moving parts than M0 needs | Not now; packaging is decided when an installer is needed |
| Hand-written Vite and esbuild setup | Full control, more to maintain | Rejected |

Package manager: npm. Native modules and Electron packaging have the fewest surprises with it.

## Constraints

- Windows 10 and 11, x64. Node.js 24 for development.
- Before fixing versions, the implementer checks the current stable releases of Electron, electron-vite, Vite, React, TypeScript, ESLint, Vitest and Playwright and that they are compatible with each other, and records the chosen versions in the PR.
- The SQLite binding is chosen in M0 by what builds cleanly for the current Electron on Windows: `better-sqlite3` first; if it does not build, Node's built-in `node:sqlite` as available in Electron's Node version. The choice and the reason go into `docs/progress.md`.
- Public repository rules apply: generic names only, no secrets. CI needs no secrets.
- GitHub Actions are pinned to a commit hash or a major version tag of well-known actions only.

## Left to the builder

- Exact ESLint rule set, Prettier settings, tsconfig split.
- How the token build step is implemented (script or Vite plugin).
- File names and the shape of the first shared function and its test.
- Whether the CI jobs run in one job or several.

## After M0

M1 starts with the spike on background sessions, hooks and status line on Windows (product spec, section 10).
