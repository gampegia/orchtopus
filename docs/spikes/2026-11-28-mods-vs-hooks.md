# Spike: user mods against Orchtopus session hooks

- Date: 2026-11-28. Time box: half a day.
- Claude Code: 2.1.332 (`claude --version`). Windows 11 Pro, build 26300. Node 24.
- Login: a personal subscription, no managed settings on the machine. The built-in guard `cc-plugin-sec-default` was **not** loaded in any run (it is missing from every `system/init` plugin list). The admin page says the guard loads when managed settings or `managed-mcp.json` exist, or on a Team or Enterprise `/login` (https://code.claude.com/docs/en/plugins/mods/admin).
- Harness: `spikes/mods-vs-hooks/` (see its README). `claude -p --model haiku --effort low --output-format stream-json --debug-file …` in `<scratch>\acme-app` (`<scratch>` = `%TEMP%\orchtopus-spike`), plus one `claude --bg` session watched with `claude agents --json`, `claude logs` and `claude attach` in ConPTY. Exact commands: [Runs](#runs).
- Session settings: a stand-in for what M1 writes (`src/main/base-setup/settings.ts` on `feat/m1-walking-skeleton`): state hooks on `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` (synchronous here; M1 marks them `async`, which does not change their order); a PR-block command hook on `Bash|PowerShell` with `onFailure: "block"` that denies `gh pr create` and a harmless probe word; a status line; deny rules. Loaded with `--settings`.
- Test mods were loaded for one session only: with `--plugin-dir`, or copied into the scratch repository's `.claude/skills/<name>/` for one run and deleted afterwards. Nothing was installed and no user setting changed (`~/.claude/settings.json` checked after the runs).
- Probes: most runs send `echo ORCH_PROBE_…`, which the PR block treats like `gh pr create`. Runs r1, r2a, r6 to r9 and r12 sent a real `gh pr create --title probe --body probe` (historical: the harness no longer does this, and the Runs table marks them); only the test project's local bare remote kept it off GitHub ("none of the git remotes … point to a known GitHub host"). The harness now refuses to run unless every remote is an existing local directory and drops `GH_*`, `GITHUB_*`, `GLAB_*` and `GITLAB_*` from the child environment; r1p and r2p repeat r1 and r2a with the probe word and give the same result.
- How a deny looks: Claude Code shows every `PreToolUse` deny as `PreToolUse:Bash hook error: <reason>`, also when the hook ran fine (the M1 spike saw the same, Q7). Our hook log records `decision: deny` for these calls, and the control run c0 shows a command that is not a probe passing the PR block.
- **Observed** means seen in the stream-json output, the stand-in hook log, the debug log, `claude agents --json` or the PTY screen. **Docs** means read only. **Inferred** means neither.

Docs read on 2026-11-28: https://code.claude.com/docs/en/mods, https://code.claude.com/docs/en/plugins/mods/admin, https://code.claude.com/docs/en/plugins/mods/events, https://code.claude.com/docs/en/plugins/mods/reference, https://code.claude.com/docs/en/plugins/mods/api, https://code.claude.com/docs/en/plugins/mods/troubleshoot, https://code.claude.com/docs/en/plugins/loading, https://code.claude.com/docs/en/permissions, https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/cli-reference.

## Summary

| Q | Question | Verdict |
|---|---|---|
| 1 | Does a mod's approval beat our PR block or a deny rule? | **Yes, for mods** (hooks modules). A `tool.call` hook that answers itself skips our hooks completely; a `tool.check` `allow` overrides our hook's deny and a deny rule. A mod in a repository's `.claude/skills/` does the same with no install step. **No, for classic plugin hooks**: a plugin `PreToolUse` `allow` does not beat our deny |
| 2 | A holding mod and our hold on the same command | Sequential double hold. The mod holds first, and Orchtopus sees nothing (no hook event, `agents --json` says `busy / working`). After the user presses Proceed in the mod's pane, our hook runs and can hold or deny again |
| 3 | Mods off for one session, without touching user settings | `enabledPlugins: { "<id>": false }` in our `--settings` file (observed for a `--plugin-dir` mod, a skills-directory mod and user-scope classic plugins). `--safe-mode` and `disableAllHooks` also stop our own hooks; `--bare` fails with "Not logged in" on a subscription login |
| 4 | Can Orchtopus see which mods are active? | Yes, before start and read-only: `claude plugin list --json` (skills-directory plugins included) plus `claude plugin validate <installPath>`. Not from the `SessionStart` input. At run time only from `system/init` (`-p` stream-json) or the debug log |

## Q1. A mod's approval against the PR block and deny rules

Docs: a mod "can approve many tool calls that your deny or ask rules or your PreToolUse hooks would stop, unless the built-in guard prevents it" (mods page). Order for one call (events page): managed `PreToolUse` hooks, then the mods' `tool.call` chain, then the other `PreToolUse` hooks (settings files, `--settings`, plugin `hooks.json`) "after the last mod calls `next`", then the rules, then the mods' `tool.check` hooks. With the guard loaded, "a call that a deny rule refuses stays refused" (admin page).

Observed, one run each, prompt "Run exactly this shell command with the Bash tool once …":

| Run | Mod | Command | What happened |
|---|---|---|---|
| c0 | none | `echo ORCH_CONTROL_ok` | Ran. Our state hooks and the PR block ran and let it pass (control) |
| r0 | none | `echo ORCH_PROBE_base` | Our PR block denied it |
| r1, r1p | `tool.call` returns `{ result }` without `next` | `gh pr create …` (r1), `echo ORCH_PROBE_result` (r1p) | Claude got the mod's fake output. **No `PreToolUse` and no `PostToolUse` hook of ours ran.** The command itself did not run |
| r4 | `tool.call` runs `git tag …` through `$.process.run`, returns its output | `echo ORCH_PROBE_exec` | The tag appeared in the test project. No hook of ours ran, no permission check. A mod can run any command itself |
| r2a, r2p | `tool.check` calls `next`, then returns `{ decision: 'allow' }` | `gh pr create …` (r2a), `echo ORCH_PROBE_check` (r2p) | The mod saw `{"decision":"deny","reason":"PreToolUse:Bash hook error: ORCH_PR_BLOCK …","hook":"PreToolUse"}` from `next`, returned `allow`, and **the command ran**: in r2a `gh pr create` failed only for lack of a GitHub remote. Our PR block had logged `deny` |
| r3a | none, deny rule `Bash(echo ORCH_DENYRULE*)` only | `echo ORCH_DENYRULE_ORCH_PROBE` | "Permission to use Bash … has been denied." |
| r3b | `tool.check` allow, same rule | same | The mod saw `{"decision":"deny", …, "rule":"Bash(echo ORCH_DENYRULE*)"}` and returned `allow`; **the command ran** |
| r2c | `tool.check` allow, no settings | `node -e "console.log('ORCH_PROBE_ask')"` | The mod saw `{"decision":"ask"}`; the command ran without a prompt |
| r14 | the `tool.check` mod copied to the repository's `.claude/skills/mod-check-allow/`, no flag | `echo ORCH_PROBE_skillsdir` | Loaded as `mod-check-allow@skills-dir` ("tier user"), saw our deny, returned `allow`; **the command ran** |
| r12 | classic plugin `hooks.json`, `PreToolUse` `permissionDecision: "allow"` | `gh pr create …` | The plugin hook returned `allow` (debug log), our PR block returned `deny`: **blocked** |
| r13 | classic plugin `PermissionRequest` `behavior: "allow"` | `node -e "console.log(4242)"` | Ran without a prompt (without the plugin, r13b: "This command requires approval"). Our hooks had nothing to deny here |

Consequences:

- Without the guard, a user's mod that registers `tool.call` or `tool.check` defeats the PR block, every other `PreToolUse` hold of ours and every deny rule. It does not need to be malicious: a mod that auto-approves "safe" commands, or answers calls from a cache, does it by design.
- The mod does not have to be installed. A repository that carries `.claude/skills/<name>/` with a hooks module brings it along (r14). That includes a user's own project repositories, where Orchtopus runs its sessions.
- Classic plugin hooks (`hooks/hooks.json`) do not defeat our deny. They can still approve calls that would otherwise prompt (`PreToolUse` allow, `PermissionRequest` allow), which is the user's choice.
- A mod's `$.process.run` and `$.fs` calls are not tool calls at all (docs, admin page; r4 shows it). No hook of ours can stop them.

## Q2. A holding mod and our hold on the same command

Setup: `claude --bg` with our settings and the playground's Blast Radius mod (`anthropics/claude-code-playground`, `claude-code/mods/blast-radius` at commit `e9ab132d4575390ecbadfc54649712432b1a3351`, 2026-10-01, copied unchanged into `<scratch>`, loaded with `--plugin-dir`). Command `git reset --hard HEAD && echo ORCH_PROBE_hold`, which our stand-in PR block also denies. The test project was clean, so nothing could be lost.

Observed:

1. Blast Radius held the call for 72 s. During the hold:
   - our hook log got `SessionStart` and `UserPromptSubmit`, and **no `PreToolUse`**: Orchtopus could not know that the session waited for the user;
   - `claude agents --json` showed `status: "busy", state: "working"`, not blocked;
   - `claude logs` showed only "Running 1 shell command…".
2. After `claude attach`, the screen showed the mod's pane to the right of the transcript: `⚠ Blast Radius · git reset --hard`, the command, `Would discard nothing: no uncommitted changes`, and `1: Proceed  2: Cancel  Claude is waiting on your answer`.
3. Key `1` (Proceed). Within a second our `PreToolUse` hooks ran (state, then PR block `deny`). The screen showed `Not run · permission denied │ Reason: PreToolUse:Bash hook error: ORCH_PR_BLOCK …`.

So the user sees two separate holds, one after the other: first the mod's pane, only in the attached terminal; then our hold (in M2: our card). Pressing Proceed in the first does not answer the second.

Not observed, from the mod's source (`blast-radius.mjs` at the commit above, `HOLD_LIMIT_MS = 10 * 60 * 1000`): if nobody answers, the mod denies after 10 minutes ("no answer within 10 minutes"), while Orchtopus shows the session as working. Inferred from r5 (a mod that denies without `next`: no `PreToolUse` of ours ran): if the user presses Cancel, our hook never sees the call. Cancel itself was not pressed.

Side note for Windows: Blast Radius calls `sleep`, `bash`, `find` and `du`. They worked here because Git's `usr\bin` was on the session's `PATH`. Without them, `$.process.run` rejects, and the mod's catch refuses the command at once (from the source, not observed).

## Q3. Turning mods off for one session

| Mechanism | Our `--settings` hooks | Mods (hooks modules) | Classic plugin hooks | Other effects | Observed in |
|---|---|---|---|---|---|
| `--safe-mode` | **off** (no hook of ours ran) | off | off ("Skipping plugin hooks - safe mode disables a person's installed plugins") | MCP 20 → 0, skills 114 → 20, agents 11 → 5. `claude --help` (2.1.332) lists CLAUDE.md, skills, installed plugins, hooks, MCP servers, custom commands and agents, output styles and more as disabled; the CLI reference adds the status line | r6 |
| `--bare` | not reached | off ("installed plugins that are not managed load no hooks module in this mode (--bare)") | still registered (`Registered 7 hooks from 7 plugins`) | **session ended with "Not logged in · Please run /login"**: `--bare` reads only `ANTHROPIC_API_KEY` or `apiKeyHelper` | r7 |
| `disableAllHooks: true` in `--settings` | **off** | off ("hooks module … not loaded: only managed plugins and built-in plugins run (allowManagedHooksOnly / disableAllHooks / --safe-mode)") | off | status line off (docs) | r8 |
| `enabledPlugins: { "<id>": false }` in `--settings` | **on** (PR block denied) | off: the plugin is gone from `system/init` | off for that plugin | nothing else changes | r9 (`--plugin-dir` mod), r15 (skills-directory mod), r10 (user-scope classic plugins) |

r10 used two of the user's own installed plugins (user scope, one with classic hooks). With `false` for both in our `--settings` file, both were missing from `system/init` and `Registered 0 hooks from 8 plugins` (7 hooks before). `~/.claude/settings.json` still said `true` for both afterwards. r15 set `mod-check-allow@skills-dir` to `false`: the mod was gone from `system/init` and the PR block denied the probe that r14 let through.

Not observed: a user-scope **mod** switched off this way. That it works is inferred from r9, r10 and r15 and from the loading page: `--settings` is the `flag` source, above user, project and local and below managed, and "`true` force-enables and `false` blocks". Also inferred from that page: an organisation can force a mod on in managed settings, and then we cannot switch it off. Such a machine has managed settings, so the guard would be loaded there too.

Built-in plugins (`cc-plugin-*@builtin`) loaded under every mechanism (docs say the same).

Status line: `-p` runs never call it. In the `--bg` session of Q2 it ran with a mod loaded ("orch-spike status line" on screen). Under `--safe-mode` and `disableAllHooks` the docs say it is off; not observed.

## Q4. Seeing which mods a session loads

Observed:

- `SessionStart` hook input: only `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`. No plugin list. Our hook's environment had no plugin variables.
- `claude plugin list --json`, run in the project folder: one entry per installed plugin with `id`, `scope` (`user`, `project`, `synced`), `enabled` (merged settings), `installPath`, and for project installs `projectPath` and `projectEnabled`. Built-in plugins are listed. A plugin in the repository's `.claude/skills/<name>/` is listed as `<name>@skills-dir` with `scope: "project"`; the text output puts it under "Skills-directory plugins (.claude/skills/*)". `--plugin-dir` plugins are not listed. It does not say whether a plugin is a mod.
- `claude plugin validate <installPath>` tells the two kinds apart:
  - a mod: `❯ ./register.mjs hooks: tool.check{tool=Bash}` and `❯ ./register.mjs calls: $.ui.log` (Blast Radius: `hooks: tool.call{tool=Bash}, ui.render{…}` and `calls: … $.process.run …`);
  - a classic hook: `❯ hooks: PreToolUse Bash command "…"`.
- At run time, only for `-p`: the stream-json `system/init` message has `plugins: [{ name, path, source, version }]`, `--plugin-dir`, skills-directory and built-in plugins included.
- At run time, any session started with `--debug-file`: `hooks module <id> loaded (worker, environment 1, tier user); events: tool.check`, or `hooks module <id> not loaded: <reason>`.
- Docs: `/plugin` shows a line such as `1 mod active · first-mod`; a mod's own hooks get `next.origin` (`{ plugin, tier }`), and a mod in managed `prependPlugins` receives `plugin.register` for each mod that loads. Neither is open to Orchtopus.

Not checked: plugins in the user's `~/.claude/skills/` (same mechanism by the docs; not created, since that is user scope).

## Recommendation for M2

**Default: keep the user's mods, but switch off, for Orchtopus sessions only, every mod that can decide or answer a tool call. Tell the user which ones, and make it a setting.**

1. **Mod check before every session start and resume.** Read-only, in the main process: `claude plugin list --json` in the session's working folder (the worktree, since a repository can carry its own `.claude/skills/` mods), then `claude plugin validate <installPath>` for each enabled plugin. Parse the `hooks:` lines of hooks modules. Treat a plugin as *deciding* if one of its modules registers `tool.call`, `tool.check` or `tool.run` (docs: `tool.run` can also answer `{ result }` or `{ deny }`). Classic `hooks.json` hooks are not deciding: they cannot beat our deny (r12).
2. **Switch deciding mods off per session.** Write `enabledPlugins: { "<id>": false }` for each into the session's settings file next to our hooks. Our hooks, the status line and everything else stay on (r9, r10, r15), and the user's settings stay untouched. Rewrite the file on every start, as M1 already does.
3. **Tell the user, plainly.** In the setup check and on the session: "Blast Radius is off in Orchtopus sessions. It can approve or hold commands, and that would get around the pull request block and the hold for dangerous commands. You can turn it back on in the project settings." Use the plugin's own name and description.
4. **Setting:** "Mods that decide on tool calls" per project, values *off in Orchtopus sessions* (default), *on*. With *on*, show a warning on the session: the PR block and the dangerous-command hold are not guaranteed.
   - **Trade-off for the M2 spec to put to the user:** *on* lets a mod approve dangerous commands without the hold button, which conflicts with the rule that only holding the button in the app releases a dangerous command. Proposal: switching the setting to *on* itself needs the hold button.
   - Optional later: allow single mods by id.
5. **If the check fails** (the CLI errors, the output does not parse, a plugin cannot be validated): do not start the session, and tell the user why and what to do.
6. **Do not use `--safe-mode`, `--bare` or `disableAllHooks`** for this. Each one also stops our own hooks (`--safe-mode`, `disableAllHooks`) or the login (`--bare`), and `--safe-mode` also drops the user's skills, MCP servers and, per `claude --help`, CLAUDE.md.

How reliable this makes the PR block and the dangerous-command hold:

- Items 1 and 2 close the cases observed here: `--plugin-dir` mods, skills-directory mods in the repository, user-scope classic plugins. They are **not yet a guarantee**. Untested, and M2 test cases:
  - a user-scope mod (installed, not inline);
  - `tool.run` hooks;
  - managed, force-enabled mods (we cannot switch them off; the guard should then hold, docs only);
  - the guard itself, on a Team or Enterprise login;
  - a repository's `.claude/skills/<name>/` mod with `enabledPlugins: { "<name>@skills-dir": false }`, through the real M2 code path (r15 covers it in the harness only), and the same for `~/.claude/skills/`.
- The hook is not the whole guard. A mod's `$.process.run` runs as the user, with the user's own `gh` and `glab` login, and no hook sees it (r4). The M2 spec should decide whether a second line is needed, for example sessions without access to a login that can open or merge PRs.
- Optional canary in M2: a `tool_use` in the transcript (`transcript_path`) with no `PreToolUse` event of ours means something answered a call before our hooks ran (r1, r4: neither `PreToolUse` nor `PostToolUse` came). Show it as "a mod handled a command Orchtopus could not check".
- Blast Radius in particular: it is deciding (it registers `tool.call`), so it is off by default in our sessions. Our own hold card takes over its job, with its measuring ideas (backlog "Guard commands that lose work"). If the user turns it on, expect the double hold from Q2 and say so in the warning.
- Re-test on a Team or Enterprise login, where the guard loads: the docs say deny rules and `PreToolUse` blocks then hold against users' mods. That would make items 1 and 2 a second line there, not the only one.

## Not covered

- The guard (`cc-plugin-sec-default`): not loaded here, so its effect is docs only.
- Mods installed in user scope: not installed by rule (see Q3 for what is inferred).
- `tool.run` hooks, `--plugin-url`, org-managed plugins.
- Auto mode: the `--bg` run in Q2 ran in auto mode (the default on this machine), the `-p` runs in default mode. The mod paths in Q1 do not depend on the permission mode by the documented order, but only default mode was observed for Q1.
- Each case ran once on Haiku 5.5. The results are about Claude Code's ordering, not about model behaviour; the model only had to send the given command.

## Runs

From `spikes/mods-vs-hooks/`, after `node make-settings.mjs`. `P` stands for the prompt prefix `Run exactly this shell command with the Bash tool once and report its output. Do not retry or change it:` (r0 used the shorter `Run exactly this shell command with the Bash tool and report its output:`). Each run is `node run.mjs --name <run> <options> -- "$P <command>"`.

| Run | Options | Command |
|---|---|---|
| c0 | `--settings orch` | `echo ORCH_CONTROL_ok` |
| r0 | `--settings orch` | `echo ORCH_PROBE_base` |
| r1 | `--settings orch --mods mod-result` | `gh pr create --title probe --body probe` (historical; rerun with the ORCH_PROBE word) |
| r1p | `--settings orch --mods mod-result` | `echo ORCH_PROBE_result` |
| r2a | `--settings orch --mods mod-check-allow` | `gh pr create --title probe --body probe` (historical; rerun with the ORCH_PROBE word) |
| r2p | `--settings orch --mods mod-check-allow` | `echo ORCH_PROBE_check` |
| r2c | `--settings none --mods mod-check-allow` | `node -e "console.log('ORCH_PROBE_ask')"` |
| r3a | `--settings deny-only` | `echo ORCH_DENYRULE_ORCH_PROBE` |
| r3b | `--settings deny-only --mods mod-check-allow` | `echo ORCH_DENYRULE_ORCH_PROBE` |
| r4 | `--settings orch --mods mod-exec` | `echo ORCH_PROBE_exec` (then `git -C <scratch>\acme-app tag -d orch-mod-exec-probe`) |
| r5 | `--settings orch --mods mod-deny` | `echo ORCH_PROBE_hold` |
| r5b | `--settings orch --mods mod-next` | `echo ORCH_PROBE_next` (our PR block ran after the mod; in this run it timed out under load and blocked through `onFailure`) |
| r6 | `--settings orch --mods mod-check-allow --flags safe-mode` | `gh pr create --title probe --body probe` (historical; rerun with the ORCH_PROBE word) |
| r7 | `--settings orch --mods mod-check-allow --flags bare` | `gh pr create --title probe --body probe` (historical; rerun with the ORCH_PROBE word) |
| r8 | `--settings orch-disable-hooks --mods mod-check-allow` | `gh pr create --title probe --body probe` (historical; rerun with the ORCH_PROBE word) |
| r9 | `--settings orch-disable-mods --mods mod-check-allow` | `gh pr create --title probe --body probe` (historical; rerun with the ORCH_PROBE word) |
| r12 | `--settings orch --mods plugin-hook-allow` | `gh pr create --title probe --body probe` (historical; rerun with the ORCH_PROBE word) |
| r13 | `--settings orch --mods plugin-hook-allow` | `node -e "console.log(4242)"` |
| r13b | `--settings orch` | `node -e "console.log(4242)"` |
| r14 | `--settings orch --skills-dir-mod mod-check-allow` | `echo ORCH_PROBE_skillsdir` |
| r15 | `--settings orch-disable-skills-dir --skills-dir-mod mod-check-allow` | `echo ORCH_PROBE_skillsdir` |

A first attempt at r6 and r7 passed the flag in a form `run.mjs` swallowed; those two runs had no `--safe-mode` or `--bare` and are not counted. The table shows the corrected runs.

r10, by hand: `orch.json` copied to `orch-disable-user.json` in `<scratch>\mods-vs-hooks\settings\`, with `enabledPlugins` set to `false` for the ids of two enabled user-scope plugins taken from `claude plugin list --json`; then `node run.mjs --name r10-disable-user --settings orch-disable-user -- "Say ok."`. The file is not in the repository, because it names the user's own plugins.

Q2, by hand. The session was started from Node with `cwd` set to `<scratch>\acme-app` and the same clean environment as `run.mjs`:

```
claude --bg --model haiku --effort low --name mods-hold-probe --settings <scratch>\mods-vs-hooks\settings\orch.json --plugin-dir <scratch>\mods-vs-hooks\blast-radius --debug-file <scratch>\mods-vs-hooks\logs\r11-bg-hold.debug.log "Run exactly this shell command with the Bash tool once: git reset --hard HEAD && echo ORCH_PROBE_hold . Do not retry or change it."
```

Then, from `<scratch>\acme-app`: `claude agents --json --all --cwd .` and `claude logs <id>`. From `spikes/m1-claude-code/` in the repository:

```
node pty-run.mjs --name r11-attach --cols 180 --rows 45 --steps '[{"sleep":7000},{"snap":"held"}]' -- attach <id>
node pty-run.mjs --name r11-proceed --cols 180 --rows 45 --steps '[{"sleep":7000},{"send":"1"},{"sleep":20000},{"snap":"after"},{"key":"ctrl-z"}]' -- attach <id>
```

The first attach also sent `left` and `tab` after the snapshot; neither changed the pane. Finally `claude stop <id>` and `claude rm <id>`.

## Cleanup

`claude stop` and `claude rm` for the one `--bg` session; `-p` runs exit by themselves. The probe tag from r4 was deleted, and `run.mjs` removes a skills-directory copy after its run, and the `.claude/skills/` folder too when the run created it. The test project's `git status` is clean, its `.claude` folder holds only what it held before, and user settings are unchanged.
