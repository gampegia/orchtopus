# Spike: user mods against Orchtopus session hooks

- Date: 2026-11-28. Time box: half a day.
- Claude Code: 2.1.332 (`claude --version`). Windows 11 Pro, build 26300. Node 24.
- Login: a personal subscription, no managed settings on the machine. The built-in guard `cc-plugin-sec-default` was **not** loaded in any run (it is missing from every `system/init` plugin list).
- Harness: `spikes/mods-vs-hooks/` (see its README). `claude -p --model haiku --effort low --output-format stream-json --debug-file …` in `<scratch>\acme-app` (`<scratch>` = `%TEMP%\orchtopus-spike`), plus one `claude --bg` session watched with `claude agents --json`, `claude logs` and `claude attach` in ConPTY.
- Session settings: a stand-in for what M1 writes (`src/main/base-setup/settings.ts` on `feat/m1-walking-skeleton`): async state hooks on `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`; a PR-block command hook on `Bash|PowerShell` with `onFailure: "block"` that denies `gh pr create` (and a harmless probe word); a status line; deny rules. Loaded with `--settings`.
- Test mods were loaded for one session only with `--plugin-dir`. Nothing was installed and no user setting changed (`~/.claude/settings.json` checked after the runs).
- The test project has only a local bare remote, so a `gh pr create` that gets through fails with "none of the git remotes … point to a known GitHub host".
- **Observed** means seen in the stream-json output, the stand-in hook log, the debug log, `claude agents --json` or the PTY screen. **Docs** means read only.

Docs read on 2026-11-28: https://code.claude.com/docs/en/mods, https://code.claude.com/docs/en/plugins/mods/admin, https://code.claude.com/docs/en/plugins/mods/events, https://code.claude.com/docs/en/plugins/mods/reference, https://code.claude.com/docs/en/plugins/mods/api, https://code.claude.com/docs/en/plugins/mods/troubleshoot, https://code.claude.com/docs/en/plugins/loading, https://code.claude.com/docs/en/permissions, https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/cli-reference.

## Summary

| Q | Question | Verdict |
|---|---|---|
| 1 | Does a mod's approval beat our PR block or a deny rule? | **Yes, for mods** (hooks modules). A `tool.call` hook that answers itself skips our hooks completely; a `tool.check` `allow` overrides our hook's deny and a deny rule. **No, for classic plugin hooks**: a plugin `PreToolUse` `allow` does not beat our deny |
| 2 | A holding mod and our hold on the same command | Sequential double hold. The mod holds first, and Orchtopus sees nothing (no hook event, `agents --json` says `busy / working`). After the user presses Proceed in the mod's pane, our hook runs and can hold or deny again |
| 3 | Mods off for one session, without touching user settings | `enabledPlugins: { "<id>": false }` in our `--settings` file. `--safe-mode` and `disableAllHooks` also stop our own hooks; `--bare` fails with "Not logged in" on a subscription login |
| 4 | Can Orchtopus see which mods are active? | Yes, before start and read-only: `claude plugin list --json` plus `claude plugin validate <installPath>`. Not from the `SessionStart` input. At run time only from `system/init` (`-p` stream-json) or the debug log |

## Q1. A mod's approval against the PR block and deny rules

Docs: a mod "can approve many tool calls that your deny or ask rules or your PreToolUse hooks would stop, unless the built-in guard prevents it" (mods page). Order for one call (events page): managed `PreToolUse` hooks, then the mods' `tool.call` chain, then the other `PreToolUse` hooks (settings files, `--settings`, plugin `hooks.json`) "after the last mod calls `next`", then the rules, then the mods' `tool.check` hooks. With the guard loaded, "a call that a deny rule refuses stays refused" (admin page). The guard loads only with managed settings or a Team or Enterprise login.

Observed, one run each, prompt "Run exactly this shell command with the Bash tool once …":

| Run | Mod | Command | What happened |
|---|---|---|---|
| r0 | none | `echo ORCH_PROBE_base` | Our PR block denied it. Hooks: `PreToolUse` state and PR block |
| r1 | `tool.call` returns `{ result }` without `next` | `gh pr create …` | Claude got the mod's fake output. **No `PreToolUse` and no `PostToolUse` hook of ours ran.** `gh` itself did not run |
| r4 | `tool.call` runs `git tag …` through `$.process.run`, returns its output | `echo ORCH_PROBE_exec` | The tag appeared in the test project. No hook of ours ran, no permission check. A mod can run any command itself |
| r2a | `tool.check` calls `next`, then returns `{ decision: 'allow' }` | `gh pr create …` | The mod saw `{"decision":"deny","reason":"PreToolUse:Bash hook error: ORCH_PR_BLOCK …","hook":"PreToolUse"}` from `next`, returned `allow`, and **`gh pr create` ran** (and failed only for lack of a GitHub remote). Our PR block had logged `deny` |
| r3a | none, deny rule `Bash(echo ORCH_DENYRULE*)` only | `echo ORCH_DENYRULE_ORCH_PROBE` | "Permission to use Bash … has been denied." |
| r3b | `tool.check` allow, same rule | same | The mod saw `{"decision":"deny", …, "rule":"Bash(echo ORCH_DENYRULE*)"}` and returned `allow`; **the command ran** |
| r2c | `tool.check` allow, no settings | `node -e "console.log('ORCH_PROBE_ask')"` | The mod saw `{"decision":"ask"}`; the command ran without a prompt |
| r12 | classic plugin `hooks.json`, `PreToolUse` `permissionDecision: "allow"` | `gh pr create …` | The plugin hook returned `allow` (debug log), our PR block returned `deny`: **blocked** |
| r13 | classic plugin `PermissionRequest` `behavior: "allow"` | `node -e "console.log(4242)"` | Ran without a prompt (without the plugin, r13b: "This command requires approval"). Our hooks had nothing to deny here |

Consequences:

- Without the guard, a user's mod that registers `tool.call` or `tool.check` defeats the PR block, every other `PreToolUse` hold of ours and every deny rule. It does not need to be malicious: a mod that auto-approves "safe" commands, or answers calls from a cache, does it by design.
- Classic plugin hooks (`hooks/hooks.json`) do not defeat our deny. They can still approve calls that would otherwise prompt (`PreToolUse` allow, `PermissionRequest` allow), which is the user's choice.
- A mod's `$.process.run` and `$.fs` calls are not tool calls at all (docs, admin page; r4 shows it). No hook of ours can stop them.

## Q2. A holding mod and our hold on the same command

Setup: `claude --bg` with our settings and the playground's Blast Radius mod (`claude-code/mods/blast-radius`, copied unchanged into `<scratch>`, loaded with `--plugin-dir`). Command `git reset --hard HEAD && echo ORCH_PROBE_hold`, which our stand-in PR block also denies. The test project was clean, so nothing could be lost.

Observed:

1. Blast Radius held the call for 72 s. During the hold:
   - our hook log got `SessionStart` and `UserPromptSubmit`, and **no `PreToolUse`**: Orchtopus could not know that the session waited for the user;
   - `claude agents --json` showed `status: "busy", state: "working"`, not blocked;
   - `claude logs` showed only "Running 1 shell command…".
2. After `claude attach`, the screen showed the mod's pane to the right of the transcript: `⚠ Blast Radius · git reset --hard`, the command, `Would discard nothing: no uncommitted changes`, and `1: Proceed  2: Cancel  Claude is waiting on your answer`.
3. Key `1` (Proceed). Within a second our `PreToolUse` hooks ran (state, then PR block `deny`). The screen showed `Not run · permission denied │ Reason: PreToolUse:Bash hook error: ORCH_PR_BLOCK …`.

So the user sees two separate holds, one after the other: first the mod's pane, only in the attached terminal; then our hold (in M2: our card). Pressing Proceed in the first does not answer the second. If nobody attaches, the mod waits up to 10 minutes and then denies ("no answer within 10 minutes"), while Orchtopus shows the session as working. If the mod's user presses Cancel, our hook never sees the call.

Side note for Windows: Blast Radius calls `sleep`, `bash`, `find` and `du`. They worked here because Git's `usr\bin` was on the session's `PATH`. Without them, `$.process.run` rejects, and the mod's catch refuses the command at once.

## Q3. Turning mods off for one session

| Mechanism | Our `--settings` hooks | Mods (hooks modules) | Classic plugin hooks | Other effects | Observed in |
|---|---|---|---|---|---|
| `--safe-mode` | **off** (no hook of ours ran) | off | off ("Skipping plugin hooks - safe mode disables a person's installed plugins") | MCP 20 → 0, skills 114 → 20, agents 11 → 5; status line off (docs) | r6 |
| `--bare` | not reached | off ("installed plugins that are not managed load no hooks module in this mode (--bare)") | still registered (`Registered 7 hooks from 7 plugins`) | **session ended with "Not logged in · Please run /login"**: `--bare` reads only `ANTHROPIC_API_KEY` or `apiKeyHelper` | r7 |
| `disableAllHooks: true` in `--settings` | **off** | off ("hooks module … not loaded: only managed plugins and built-in plugins run (allowManagedHooksOnly / disableAllHooks / --safe-mode)") | off | status line off (docs) | r8 |
| `enabledPlugins: { "<id>": false }` in `--settings` | **on** (PR block denied) | off: the plugin is gone from `system/init` | off for that plugin | nothing else changes | r9 (`--plugin-dir` mod), r10 |

r10 used two of the user's own installed plugins (user scope, one with classic hooks). With `false` for both in our `--settings` file, both were missing from `system/init` and `Registered 0 hooks from 8 plugins` (7 hooks before). `~/.claude/settings.json` still said `true` for both afterwards. Docs (loading page): `--settings` is the `flag` source, above user, project and local and below managed. "`true` force-enables and `false` blocks". So an organisation can force a mod on, and then we cannot switch it off; in that case the guard is loaded as well.

Built-in plugins (`cc-plugin-*@builtin`) loaded under every mechanism (docs say the same).

Status line: `-p` runs never call it. In the `--bg` session of Q2 it ran with a mod loaded ("orch-spike status line" on screen). Under `--safe-mode` and `disableAllHooks` the docs say it is off; not observed.

## Q4. Seeing which mods a session loads

Observed:

- `SessionStart` hook input: only `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`. No plugin list. Our hook's environment had no plugin variables.
- `claude plugin list --json`, run in the project folder: one entry per installed plugin with `id`, `scope` (`user`, `project`, `synced`), `enabled` (merged settings), `installPath`, and for project installs `projectPath` and `projectEnabled`. Built-in plugins are listed. `--plugin-dir` plugins are not. It does not say whether a plugin is a mod.
- `claude plugin validate <installPath>` tells the two kinds apart:
  - a mod: `❯ ./register.mjs hooks: tool.check{tool=Bash}` and `❯ ./register.mjs calls: $.ui.log` (Blast Radius: `hooks: tool.call{tool=Bash}, ui.render{…}` and `calls: … $.process.run …`);
  - a classic hook: `❯ hooks: PreToolUse Bash command "…"`.
- At run time, only for `-p`: the stream-json `system/init` message has `plugins: [{ name, path, source, version }]`, `--plugin-dir` and built-in plugins included.
- At run time, any session started with `--debug-file`: `hooks module <id> loaded (worker, environment 1, tier user); events: tool.check`, or `hooks module <id> not loaded: <reason>`.
- Docs: `/plugin` shows a line such as `1 mod active · first-mod`; a mod's own hooks get `next.origin` (`{ plugin, tier }`), and a mod in managed `prependPlugins` receives `plugin.register` for each mod that loads. Neither is open to Orchtopus.

Not checked: plugins in a skills directory (`~/.claude/skills/<name>/` or a repository's `.claude/skills/<name>/`, id `<name>@skills-dir`). Docs say they load with no install step; `plugin list` groups them as "Skills-directory".

## Recommendation for M2

**Default: keep the user's mods, but switch off, for Orchtopus sessions only, every mod that can decide or answer a tool call. Tell the user which ones, and make it a setting.**

1. **Mod check before every session start and resume.** Read-only, in the main process: `claude plugin list --json` in the session's working folder, then `claude plugin validate <installPath>` for each enabled plugin. Parse the `hooks:` lines of hooks modules. Treat a plugin as *deciding* if one of its modules registers `tool.call`, `tool.check` or `tool.run` (docs: `tool.run` can also answer `{ result }` or `{ deny }`). Classic `hooks.json` hooks are not deciding: they cannot beat our deny (r12). Also scan the skills directories, since `plugin list` may not show every one of them (unchecked).
2. **Switch deciding mods off per session.** Write `enabledPlugins: { "<id>": false }` for each into the session's settings file next to our hooks. Our hooks, the status line and everything else stay on (r9, r10), and the user's settings stay untouched. Rewrite the file on every start, as M1 already does.
3. **Tell the user, plainly.** In the setup check and on the session: "Blast Radius is off in Orchtopus sessions. It can approve or hold commands, and that would get around the pull request block and the hold for dangerous commands. You can turn it back on in the project settings." Use the plugin's own name and description.
4. **Setting:** "Mods that decide on tool calls" per project, values *off in Orchtopus sessions* (default), *on*. With *on*, show a warning on the session: the PR block and the dangerous-command hold are not guaranteed. Optional later: allow single mods by id.
5. **Do not use `--safe-mode`, `--bare` or `disableAllHooks`** for this. Each one also stops our own hooks (`--safe-mode`, `disableAllHooks`) or the login (`--bare`), and `--safe-mode` drops the user's skills, MCP servers and CLAUDE.md as well.

Keeping the PR block and the dangerous-command hold reliable:

- They only hold while no deciding mod is loaded. Item 2 is the guarantee; the mod check is part of starting a session, and a check that fails (CLI error, unparsable output) fails closed: start the session with every non-built-in plugin that has a hooks module switched off, and say so.
- The hook is not the whole guard. A mod's `$.process.run` runs as the user, with the user's own `gh` and `glab` login, and no hook sees it (r4). The M2 spec should decide whether a second line is needed, for example sessions without access to a login that can open or merge PRs.
- Optional canary in M2: a `tool_use` in the transcript (`transcript_path`) with no `PreToolUse` event of ours means something answered a call before our hooks ran (r1, r4: neither `PreToolUse` nor `PostToolUse` came). Show it as "a mod handled a command Orchtopus could not check".
- Blast Radius in particular: it is deciding (it registers `tool.call`), so it is off by default in our sessions. Our own hold card takes over its job, with its measuring ideas (backlog "Guard commands that lose work"). If the user turns it on, expect the double hold from Q2 and say so in the warning.
- Re-test on a Team or Enterprise login, where the guard loads: the docs say deny rules and `PreToolUse` blocks then hold against users' mods. That would make item 2 a second line there, not the only one. Not testable on this machine.

## Not covered

- The guard (`cc-plugin-sec-default`): not loaded here, so its effect is docs only.
- Mods installed in user scope: not installed by rule. The user-scope plugins in r10 have classic hooks only; that `enabledPlugins: false` from `--settings` also stops a user-scope *mod* is inferred from r9 (an inline mod) and r10 (user-scope plugins).
- `tool.run` hooks, `--plugin-url`, skills-directory plugins, org-managed plugins.
- Auto mode: the `--bg` run in Q2 ran in auto mode (the default on this machine), the `-p` runs in default mode. The mod paths in Q1 do not depend on the permission mode by the documented order, but only default mode was observed for Q1.
- Each case ran once on Haiku 5.5. The results are about Claude Code's ordering, not about model behaviour; the model only had to send the given command.

## Cleanup

`claude stop` and `claude rm` for the one `--bg` session; `-p` runs exit by themselves. The probe tag from r4 was deleted. The test project's `git status` is clean, and user settings are unchanged.
