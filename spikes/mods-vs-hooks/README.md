# Spike harness: user mods against Orchtopus session hooks

Small Node 24 scripts that run `claude -p` in the M1 test project with Orchtopus-like session settings and test mods loaded for one session only. Findings and the exact command of every run: `docs/spikes/2026-11-28-mods-vs-hooks.md`.

Nothing is installed into user scope and no user settings change. Runs write only to `%TEMP%\orchtopus-spike\mods-vs-hooks\` (settings, copies of the mods, logs), and with `--skills-dir-mod` to the test project's `.claude\skills\<mod>\` for the length of one run. Sessions run in `%TEMP%\orchtopus-spike\acme-app`, made by `node ../m1-claude-code/setup.mjs`.

Safety: `run.mjs` refuses to run unless every remote of the test project is a local path, and drops `GH_*`, `GITHUB_*`, `GLAB_*` and `GITLAB_*` from the child environment. Probe commands use the word `ORCH_PROBE`, never a real `gh pr create`.

## Files

| File | Purpose |
| --- | --- |
| `make-settings.mjs` | Writes the settings variants and copies the mods to the scratch folder |
| `hook.mjs --label state\|pr-block` | Stand-in for the Orchtopus hooks. `pr-block` denies any command with `ORCH_PROBE` (and `gh pr create`), like the M1 PR block (`onFailure: "block"`) |
| `statusline.mjs` | Status line command that logs each run |
| `run.mjs --name <run> [--settings <variant>] [--mods a,b] [--skills-dir-mod <mod>] [--flags safe-mode,bare] -- "<prompt>"` | One `claude -p` run (`--model haiku --effort low`, stream-json, `--debug-file`). `--mods` loads each mod with `--plugin-dir`; `--skills-dir-mod` copies one into the test project's `.claude\skills\` and removes it afterwards. Prints tool calls, results, the final text, the stand-in hooks that ran and the loaded plugins from `system/init` |
| `lib.mjs` | Paths, the child environment and the local-remote check |
| `mods/<name>/` | Test mods (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.mjs`) |

Settings variants:

- `orch`: synchronous state hooks, PR block, status line, deny rule `Bash(echo ORCH_DENYRULE*)`
- `deny-only`: the deny rule alone
- `orch-disable-hooks`: `orch` plus `disableAllHooks: true`
- `orch-disable-mods`: `orch` plus `enabledPlugins` with every test mod (`<mod>@inline`) set to `false`
- `orch-disable-skills-dir`: `orch` plus `enabledPlugins: { "mod-check-allow@skills-dir": false }`

Test mods:

| Mod | What it does for a probe command |
| --- | --- |
| `mod-result` | `tool.call`: answers `{ result }` itself, never calls `next` |
| `mod-check-allow` | `tool.check`: calls `next`, logs the decision, then returns `{ decision: 'allow' }` |
| `mod-deny` | `tool.call`: returns `{ deny }` without `next` (stand-in for a holding mod) |
| `mod-next` | `tool.call`: logs and calls `next` |
| `mod-exec` | `tool.call`: runs `git tag orch-mod-exec-probe` through `$.process.run` and returns its output |
| `plugin-hook-allow` | Not a mod: classic `hooks.json` hooks. `PreToolUse` allow for a probe, `PermissionRequest` allow for `node -e` |

The Q2 run used the playground's Blast Radius mod (`anthropics/claude-code-playground`, `claude-code/mods/blast-radius` at commit `e9ab132d4575390ecbadfc54649712432b1a3351`), copied unchanged to `<scratch>\mods-vs-hooks\blast-radius\` and loaded with `--plugin-dir` in a `claude --bg` session; the screen was read with `../m1-claude-code/pty-run.mjs -- attach <id>`.

## Run

```
node make-settings.mjs
node run.mjs --name r1p-result --settings orch --mods mod-result -- "Run exactly this shell command with the Bash tool once and report its output. Do not retry or change it: echo ORCH_PROBE_result"
```

Delete the probe tag after `mod-exec` runs: `git -C %TEMP%\orchtopus-spike\acme-app tag -d orch-mod-exec-probe`.
