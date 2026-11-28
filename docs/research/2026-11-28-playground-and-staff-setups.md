# Playground and staff setups: verified findings

Research date: 2026-11-28. Three reports were written, then checked against the sources by an adversarial pass. Where the check corrected a report, the check wins. This file keeps only the verified result. Quotes are under 15 words.

Sources compared:

- The repository `anthropics/claude-code-playground` (branch `main`, last commit 2026-10-01).
- Public setups and posts by Anthropic and OpenAI staff, 2026.
- Claude Code documentation, checked 2026-11-28. Docs pages are undated; "seen" means the date we read them.

Verdicts: **confirmed**, **partly** (the point holds, a detail was corrected), **unverified**.

Where the findings went: `docs/backlog.md` (entries marked "Added 2026-11-28") and `docs/evidence/claude-code-setup.md` (EV-I3 to EV-I5).

## 1. Already done

The playground and the staff posts mostly confirm choices we made. No action.

- Third-party Actions pinned to a commit SHA (`ci.yml`, gitleaks).
- `.gitignore` for `.env`, `.claude/settings.local.json`, local settings.
- Privacy rule, privacy reviewer and gitleaks in CI.
- Fail closed: a hook error, timeout or unreadable command blocks the command.
- The deny reason tells Claude not to retry unless the user asks.
- The answer is bound to the exact held command, and holds are queued.
- Safe default on the card: ours is a 1 s hold, never a hotkey.
- A command reader for separators, quotes, `sudo`, `bash -c`, `pwsh -Command`.
- Context fill and limits from the status line.
- Turn events from `UserPromptSubmit` and `Stop`.
- Extras for one session through `--plugin-dir`, not installed.
- Stop hook exit code 2 blocks, exit 1 does not (EV-H2).
- Auto mode with deny rules for irreversible actions (D1).
- Sandbox covers shell commands only (EV-I1).

## 2. Product

### 2.1 Blast radius on the dangerous-command card

- **Verdict:** confirmed.
- **Source:** `claude-code/mods/blast-radius/hooks/blast-radius.mjs` (528 lines, measuring code at lines 294 to 470), `main`, last commit 2026-10-01.
- **What it measures before a command runs:**
  - `rm`: file count, total size, the first 10 files.
  - `git reset --hard`: dirty files (untracked excluded) and a short diff stat.
  - `git checkout -- .` and `git restore .`: files with unstaged changes.
  - `git clean`: runs `git clean -n` with the user's flags.
  - Force push: commits on the remote that HEAD lacks, "as of the last fetch".
  - Migrations: pending ones for django, alembic, rails and prisma.
- **For us:** compute it in the main process with Node `fs` and `git`, never by running project tools. Their script needs `bash`, `find` and `du`, so it does not run on native Windows. Migration listers load project code, so we skip them.
- **Backlog:** "Guard commands that lose work (blast radius)", M2.

### 2.2 More patterns for the dangerous list

- **Verdict:** confirmed.
- **Patterns we do not name yet:** `git clean` (any flags), `git checkout -- .`, `git restore .`, force push as `+refspec` or `--force-with-lease`, migrations.
- **Their known misses, useful as test cases:** `xargs rm`, `find -delete`, `timeout 5 rm`, `doas rm`.
- **Decision (user, 2026-11-28):** everything that can lose work counts as dangerous by default, also inside the session's worktree, and every rule is a setting. Folded into the entry above.

### 2.3 User mods run inside our sessions

- **Verdict:** confirmed, with additions. Source: https://code.claude.com/docs/en/mods (seen 2026-11-28).
- Mods load by default from Claude Code 2.1.287 (terminal) and 2.1.286 (Desktop). Quote: "Mods are on by default."
- They load wherever hooks run, including `claude -p`. Only `--safe-mode`, `--bare`, `disableAllHooks: true` or a disabled plugin turns them off.
- Orchtopus passes neither `--bare` nor `--safe-mode`, so a user's mods probably load in our sessions. This is an inference. It is not tested.
- The docs say a mod "can approve many tool calls" that deny rules or `PreToolUse` hooks would stop, unless the built-in guard `cc-plugin-sec-default` prevents it. With the guard loaded, a user's mod cannot do this by default.
- We cannot use `disableAllHooks` to switch mods off: it also stops our own hooks.
- **Risks:** a double hold (a mod and our hook on the same command), and our PR block or dangerous-command hold being bypassed.
- **Backlog:** "User mods in Orchtopus sessions", M2 check.

### 2.4 Plans as designed HTML pages

- **Verdict:** content confirmed, date corrected.
- **Source:** Thariq Shihipar, essay on HTML as the plan format, https://claude.dev/blog/using-claude-code-the-unreasonable-effectiveness-of-html/ , dated **2026-05-20**.
  - He writes "an implementation plan in HTML" and does not read Markdown over about 100 lines.
  - 2026-05-08 is the date of Simon Willison's link post to an X version: https://simonwillison.net/2026/May/8/unreasonable-effectiveness-of-html/ . His summary frames it around PR review, not plans.
  - The claude.dev page shows no repost note, so we do not claim one.
- **Backlog:** "Plans and specs that are quick to review". User decision 2026-11-28: the user reviews specs and plans as designed HTML pages inside Orchtopus.

### 2.5 Cross-session messaging

- **Verdict:** confirmed, one correction on the default. Source: https://code.claude.com/docs/en/cross-session-messaging (features from 2.1.224 to 2.1.309, seen 2026-11-28).
- Same-machine messaging needs 2.1.224 (macOS, Linux, WSL 2) or 2.1.234 (native Windows).
- On native Windows each session binds a named pipe. Its path is `CLAUDE_CODE_MESSAGING_SOCKET`. The per-session token is `CLAUDE_CODE_MESSAGING_TOKEN`. Both go to hooks and Bash commands. The first line sent must be an auth line with the token.
- `crossSessionInbound` takes `accept`, `hold` or `refuse`. **There is no fixed default.** When unset, Claude Code decides per message from the permission modes of sender and receiver.
- A message never approves a permission. Messages count toward usage. `--bare` sessions bind no socket. WSL 2 and native Windows sessions cannot reach each other.
- Channels (research preview) push events into a running session through an MCP server. Custom channels need `--dangerously-load-development-channels`. Not usable for us now.
- **Backlog:** "Cross-session messaging", spike of about 0.5 day. Orchtopus must set `crossSessionInbound` explicitly.

### 2.6 Claude Code Projects

- **Verdict:** confirmed. Sources: https://code.claude.com/docs/en/claude-projects (seen 2026-11-28), https://claude.com/blog/projects-redesigned (2026-09-17).
- One coordinator conversation starts threads. Threads are mostly cloud sessions. On request, a thread runs locally through Remote Control (2.1.280 or later).
- **Limits:**
  - No CLI, no API, no `settings.json` keys, no local state. It cannot be called from Orchtopus.
  - github.com only. No GitHub Enterprise Server, GitLab or Bitbucket.
  - Not on Team or Enterprise yet. Public beta on Pro, Max and Ultra.
  - Cloud threads ignore `.claude/settings.json` rules and hooks.
- **Ideas worth taking:**
  - A **Landing** state: "pull request is approved or queued to merge". We derive it from `gh` or `glab`.
  - "Continue threads automatically when usage limits reset" is "On by default".
  - Idle threads wake on CI failure or a review comment, not on a timer.
  - Auto-resolve after a week without activity.
  - Default models: Opus everywhere, `medium` for threads, `low` for the coordinator.
- **One possible bridge:** host `claude remote-control --spawn worktree --settings <ours>`. Unproven. Open questions: does a spawned thread use our hooks, and can we attach a PTY.
- On native Windows the local `/steward` PR watch does not start. So we build our own CI watcher.
- **Backlog:** "Claude Code Projects: precedent, not a building block".

### 2.7 Checks out of the change's reach

- **Verdict:** confirmed. Source: Addy Osmani, https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/ , 2026-11-16. His site says he is a Member of Technical Staff at Anthropic. The post page itself shows only his name.
- Review rules are read from the base branch, "never from the pull request's changes".
- The gate has three modes: off, observe, enforce.
- Each commit carries a verification stamp, "none" included.
- After three failed rounds Claude "brings in a human". Our setting default is 2 [EV-H1]. Both are settings. Recheck in M4.
- Severity tags: Important, Nit, Pre-existing.
- Quote: "We don't try to improve reviews by stacking on more reviewers."
- Flaky tests may not be skipped, slept or retried.
- Caveats: the grader gain "up to 10 points" comes from internal tests on one task type. "3 to 10 checklist items per change" is a typical range.
- **Backlog:** "Checks out of the change's reach", M3/M4.

### 2.8 Review council: verified findings and approvals per path

- **Verdict:** partly. Lydia Hallie works on Claude Code at Anthropic (ai.engineer talk page, 17:31 long). **The talk date is unverified.** One third-party note says 2026-11-11. Source: https://ai.engineer/talks/vlfCjWuv4es-rethinking-claude-code-best-practices .
- **Verified findings.** Quote: "A separate group of agents double-checks each bug it reports." The docs (https://code.claude.com/docs/en/code-review) describe four stages: find, verify, rank, post. Verification reads code. It does not build or run it.
- **Review level.** Code Review has Quick, Standard and Deep, set by the owner. The docs give no agent count.
- **"Risk tier" means the number of human reviewers.**
  - Docs and copy edits may merge on green checks alone. Ordinary changes may need one human. Risky changes may need two. The talk says "may": it is guidance.
  - The documented mechanism is Claude Approvals, `.claude/approvals.yml`, read from the default branch: https://code.claude.com/docs/en/approvals . Rules set seats per path. Public beta, Team and Enterprise, github.com only.
  - The policy author decides the tier, not the reviewer agent.
- Code Review never approves or blocks by itself.
- **Backlog:** "Review council (M4)". Additive: our own reviewers do the verification, and none is removed.

### 2.9 Last-turn change list and context delta

- **Verdict:** confirmed (read in the code, not tested). Sources: `replay-theater.mjs` lines 77 to 102 and 195 to 221; `token-weather.mjs` lines 40 to 47 and 78 to 121.
- **Last-turn change list:** record each file edit of a turn and step through them. Use `PostToolUse`, so failed edits do not show. It misses edits made through Bash.
- **Context delta:** keep one reading per turn, show tokens of the window and the change since the last turn. Their finding: percent of the full window (81 %) differs from Claude Code's own notice (90 %), which counts to the auto-compact point.
- Field names for subagent ids and the status line tokens must be checked in the docs first.
- **Backlog:** "Last-turn change list and context delta per turn", M4/M5.

## 3. Dev workflow for this repository

See the backlog entry "Dev-workflow items for this repository".

- **Protect `main`.** `gh api` reports "Branch not protected". The rule "never push to main" is text only.
  - Use a ruleset: PR plus green CI, no required human approval, because the lead merges itself.
  - The user must set it in GitHub.
- **Dependabot.** The playground has a weekly `github-actions` config. We have tags that nobody updates, plus Electron and native modules.
- **PR template.** Short, with our definition of done and the agents used.
- Lower value: a licence check as an npm script, `SECURITY.md`, and a not-affiliated line in the README.

## 4. Other verified items (no backlog entry)

| Item | Verdict | Use |
|---|---|---|
| Thariq Shihipar, 2026-07-24 post: https://claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models/ | partly | Judgment over rules, "removed over 80% of Claude Code's system prompt", a verification skill in CLAUDE.md. Corrections: his rubrics are for **verifier agents**, and examples constrain exploration, which is not "remove all examples". Feeds EV-H8. |
| Every podcast with Codex staff, 2026-02-18 | confirmed | Event-driven PR upkeep is the pattern. We poll `gh` and `glab` ourselves and wake a session only on an event. |
| OpenAI "Harness engineering", Ryan Lopopolo, 2026-02-11 | confirmed | Lint messages that tell the agent the fix. Per-worktree app start is already F69. "Humans may review pull requests, but aren't required to": not adopted (E24). |

## 5. Not relevant

- CLA workflow and `CODEOWNERS`: one maintainer.
- Code of conduct: no community yet.
- Private source repo with manual export: we develop in public with a privacy reviewer.
- "No attribution trailers" rule: conflicts with our commit trailer rule.
- Mod UI code (panes, bands, weather icons, fixed bands at 25/50/75/90 %): we draw our own panels, and EV-C4 sets no thresholds.
- Mod-only APIs and a local `marketplace.json` (installing writes user settings).
- Auto-merge of low-risk PRs (E24: Orchtopus never merges the user's PRs).
- Codex-only features: the Windows sandbox, automations. Only the patterns carry over.
- Placeholder folders in the playground. Look again when they get content.

## 6. Dropped as untraceable

Eleven second-hand claims were dropped, among them a context-rot figure attributed to Thariq, a "98 to 99 % of bugs" Code Review figure, and reports about staff changes. None has an original source we could open.
