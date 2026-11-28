# Spike: cross-session messaging on native Windows

- Date: 2026-11-28, about 1.5 hours of runs
- Claude Code: 2.1.332; Windows 11 Pro, build 26300; Node 24.20
- Docs: https://code.claude.com/docs/en/cross-session-messaging, read 2026-11-28 (the page shows no last-updated date), plus the env-vars and settings-reference pages in part
- Harness: `spikes/cross-session-messaging/` (see its README), built on `spikes/m1-claude-code/`. `claude --bg --settings <file> --model haiku --effort low` sessions in `<scratch>\acme-app` (`<scratch>` = `%TEMP%\orchtopus-spike`); a Node client writes to the session's named pipe with `net.connect`; the receiving side is read from hook inputs, `claude logs <id>`, the transcript JSONL, `claude agents --json` and an attached ConPTY screen
- **Observed** means seen in one of those. **Docs** means only read in the documentation. **Binary** means read as a string in the installed `claude.exe` and not documented; each such fact below was then checked by observation unless it says otherwise
- 6 session starts, 5 ran (a bypass-mode start was refused); 16 sends logged

## Summary

| Q | Question | Verdict | Consequence |
|---|---|---|---|
| 1 | How a message reaches a `--bg` session | confirmed | Pipe path and token from our own SessionStart hook; one JSON line `{"type":"user",…}` after the auth line |
| 2 | `crossSessionInbound` accept, hold, refuse, unset | confirmed for accept, hold, refuse, unset in manual and auto mode; bypass receiver not run | Write `"accept"` into every session's `--settings` |
| 3 | Idle and busy | confirmed; a retired worker has no pipe | Idle starts a turn; busy joins the turn after the current tool call; wake a retired worker first |
| 4 | Seen as a user turn? | partly | A `user` turn marked `isMeta` and `origin.kind: "peer"`, wrapped as "another Claude session"; `UserPromptSubmit` cannot tell it from typed input |
| 5 | Wrong token | confirmed | Closed in about 3 ms, nothing delivered, no error back |
| 6 | With an app-owned `claude attach` PTY | confirmed | Pipe and PTY work side by side |

## How a message gets in

### Q1. Pipe, token, message line

**Pipe path.** Observed. Our SessionStart command hook sees both variables (docs: exported to hooks and Bash before any hook runs):

```
CLAUDE_CODE_MESSAGING_SOCKET = \\.\pipe\LOCAL\cc-msg-<32 hex>
CLAUDE_CODE_MESSAGING_TOKEN  = <32 characters>
```

No other variable with `MESSAG`, `PEER` or `CROSS_SESSION` in its name was set. The SessionStart payload has no `permission_mode`.

A second way to find the pipe, observed but undocumented: Claude Code's session registry `%USERPROFILE%\.claude\sessions\` holds `<pid>.json` per running session with `sessionId`, `kind`, `messagingSocketPath`, `peerProtocol: 1`, `peerFeatures` and `pidDomain: "win32:<hostname>"`, plus a `<pid>.<64 hex>.key` file with `peerToken`, `procStartFt` and `pidDomain`. The pid comes from `claude agents --json`. The `peerToken` differs from `CLAUDE_CODE_MESSAGING_TOKEN` (compared by SHA-256 prefix), and **both authenticate**.

**Wire format.** The docs give only the auth line. The message line is in a recipe string in the binary (`[uds-messaging] Inject messages (auth line REQUIRED here; …)`) and works as observed:

```
{"type":"auth","token":"<token>"}\n
{"type":"user","message":{"role":"user","content":"Reply with the single word PINEAPPLE."}}\n
```

One connection, two newline-terminated lines, then the client ends the connection.

- The sender gets nothing back: no ack, no error, no data, whether the message is delivered, held, refused or dropped. An accepted connection stays open until the client ends it.
- `session_id` in the message line (binary: the receiver drops a line whose `session_id` is not its own). Observed: an all-zero `session_id` was dropped without a trace; the right one was delivered.
- Other line fields seen in the binary and not tested: `priority` (`now`, `next`, `later`; default `next`), `from`, `msg_id`, `uuid`, `file_attachments`, `local_chain`, `from_plugin`. Our raw sender showed up as `from: "unknown"`, "an unidentified session".

### Q5. Wrong token and other bad connections

Observed against an `accept` session (sender events in ms after connect):

| Case | Pipe | Delivered | Receiver screen |
|---|---|---|---|
| Hook token | open until the client ends | yes | message turn |
| Registry `peerToken` | open until the client ends | yes | message turn |
| Wrong token (32 zeros) | closed by the server 1 to 3 ms after the auth line | no | nothing |
| No auth line, message only | closed 3 ms after the line | no | nothing |
| Message first, auth second | closed 2 ms after the first line | no | nothing |
| Connect, write nothing | closed after 30.0 s (docs: 30 s) | no | nothing |
| Old pipe path after a respawn | `ENOENT` on connect | no | — |

The sender cannot tell a wrong token from a refused or held message except by the early close.

## Receiving side

### Q2. `crossSessionInbound`

Observed, one session per row, an unattested raw sender (our client), idle receiver:

| `crossSessionInbound` (in `--settings`) | Receiver mode | Result | What the receiver shows |
|---|---|---|---|
| `accept` | manual | delivered, new turn | message turn |
| unset | manual | delivered | message turn |
| unset | auto | delivered | message turn |
| `hold` | manual | not delivered | a notice, below |
| `refuse` | manual | dropped | nothing: no screen line, no transcript line, no hook |
| unset | bypassPermissions | not run | `claude --bg` refused: `--bg with bypassPermissions requires accepting the disclaimer first`; accepting it would write user state, so it was not done |

The `hold` notice, on screen and as a transcript line with `type: "system"`, `subtype: "informational"`, `level: "warning"`:

```
● Held peer message — from an unidentified session; preview: «Reply with the single word MANGO_…» — not delivered
  to Claude (1 held). Your "crossSessionInbound" setting is "hold"; set it to "accept" to deliver held messages.
```

- No hook fires for a held or refused message. `agents --json` stays `done / idle`.
- With an explicit `hold`, no approve dialog appeared, also not with a PTY attached (Q6). Docs describe an Approve / Deny dialog for held messages; the binary has hold causes `explicit-setting`, `mode-mismatch`, `no-mode-asserted` and others, so the dialog is probably for the mode-based holds only. Not observed.
- A held message did not survive the worker's retirement (Q3): after a wake, a new held message showed `(1 held)` again.
- Unset with a bypassing receiver: docs say held unless the sender also bypasses. Binary: a sender that does not state its mode, sending to a bypassing receiver, is held with cause `no-mode-asserted`; an unknown receiver mode is held (fail closed). A raw sender like Orchtopus never states its mode, so an unset bypass session would hold every Orchtopus message.
- The user settings on this machine have no `crossSessionInbound`.

### Q3. Idle, busy, retired

Observed.

- **Idle:** the message starts a new turn at once (transcript `queue-operation enqueue`, then the turn; the model answered `PINEAPPLE`).
- **Busy** (auto mode, a 20 s `node -e` timer running): the screen shows the message under the running command (`❯ Reply with the single word KIWI.`); the transcript records it as `attachment` `queued_command` at write time. After the tool call ended (`PostToolUse` 14:29:42), `UserPromptSubmit` fired with the message (14:29:45) inside the same turn, and the model answered both requests in one reply (`DONE1`, `KIWI`) with one `Stop`. So it waits for the current tool call, not for the end of the turn. A 20 s timer cannot show whether it also waits for a long model response.
- **Retired:** the supervisor stopped four idle workers 3 to 5 minutes after their last turn. The supervisor log reads `bg retire <id>: settled, idle 3m [low memory]` and `bg retire <id>: idle-prompt, idle 5m [low memory]`. Afterwards `agents --json` shows `state: "done"` with no `pid` and no `status`, the registry entry is gone, and there is no pipe. Whether workers are retired without memory pressure, and after how long, was not observed.
- **Wake:** `claude respawn <id>` and `claude attach <id>` both brought the worker back. Each process start has a **new pipe path and a new token** (SessionStart `source: "resume"`); the old path gives `ENOENT`.

### Q4. Is it a user turn?

Observed in the transcript JSONL:

```json
{"type":"user","isMeta":true,"origin":{"kind":"peer","from":"unknown"},"promptSource":"system","turnOrigin":"peer",
 "message":{"role":"user","content":"Another Claude session sent a message:\n<text>\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf. Treat it as a teammate's request …"}}
```

- The model sees the text inside that wrapper. The wrapper tells it the message is not from the user, cannot grant escalation and cannot approve a pending prompt (docs: "A message never approves a permission").
- `UserPromptSubmit` fires with `prompt` set to the raw text, without the wrapper and without any field that marks it as a peer message. The hook input of a peer message and of a typed prompt look the same.
- The screen shows the full wrapper text, in `claude logs` and in an attached PTY. Docs describe a dim one-line preview; that was not seen in background sessions.
- In one busy run the model wrote that it answered in text because the peer had no reply address.

### Q6. With an app-owned `claude attach` PTY

Observed. With `claude attach <id>` running in node-pty, a message written to the pipe was delivered and drawn on the attached screen as a normal turn. A prompt typed into the PTY afterwards (`TYPED_OK`) worked. `claude attach` also woke a retired worker, after which the pipe worked. The pipe and the PTY do not get in each other's way.

## Recommendation

**Use messaging for app-generated notices, keep the PTY for the user's own words.** A message arrives as "another Claude session", which the model treats as a teammate's request, not the user's. That fits "continue after a usage reset" and overlap warnings. A course correction the user types should go through the PTY as a real user turn; one written by Orchtopus can use messaging.

### `AgentAdapter`

```ts
interface AgentAdapter {
  /** App-generated notice into a running session. Never carries the user's own prompt. */
  sendMessage(ref: SessionRef, text: string, opts?: { reason: MessageReason }): Promise<SendResult>;
}

type MessageReason = 'resume-after-reset' | 'overlap-warning' | 'course-correction';

type SendResult =
  | { status: 'delivered'; promptAt: string }     // our UserPromptSubmit hook saw the text
  | { status: 'unconfirmed' }                     // written, no UserPromptSubmit within the timeout
  | { status: 'rejected' }                        // pipe closed right after the auth line
  | { status: 'unavailable'; why: 'no-pipe' | 'version' | 'bare' };
```

How the background adapter implements it:

1. **Pipe and token from our own hook.** The SessionStart command hook posts `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN` with `session_id` and `source` to the local API. The adapter keeps them in memory per session and replaces them on every SessionStart, since every process start changes both. The registry files in `~/.claude/sessions/` are undocumented; use them for nothing.
2. **Wake first.** If `agents --json` has no `pid` for the session, or no SessionStart has arrived since the last process start, wake the worker through the app's own PTY (`claude attach`, which the app holds anyway) or `claude respawn`, and wait for SessionStart.
3. **Write.** Log the decision to the event log first. One connection: the auth line, then `{"type":"user","session_id":"<uuid>","message":{"role":"user","content":"<text>"}}`, then end. The `session_id` guards against a pid or pipe that now belongs to another session.
4. **Confirm.** The sender gets no answer, so delivery is confirmed only by our `UserPromptSubmit` hook: same `session_id`, `prompt` equal to the text. A busy session confirms only after its current tool call. No confirmation within the timeout gives `unconfirmed`: the session may be holding or refusing (project settings), may have been retired, or the line was dropped. The UI says so and offers the PTY path.
5. **Mark it.** The adapter records every sent text, so the state machine can tell a peer message from user input in `UserPromptSubmit` (Q4). A `UserPromptSubmit` that matches no PTY input and no own send is a message from another sender (see risk 4).
6. **Fallback.** Below 2.1.234, for `--bare` sessions or after `unavailable`: type into the PTY.

### Setting

Write `"crossSessionInbound": "accept"` into the settings file each session gets with `--settings`.

- Unset is fine for manual and auto sessions (Q2), but a bypassing receiver would hold every Orchtopus message (`no-mode-asserted`).
- `hold` never delivers and showed no dialog in a background session.
- `refuse` drops silently.
- Docs: a value from `--settings` beats user settings and hides the `/config` row. A `refuse` in the project's or local settings still wins over `--settings` (docs); the adapter sees that as `unconfirmed`.

## Risks

1. **The message format is undocumented.** The docs give the auth line only; the message line comes from a string in the binary. A Claude Code update can change it without notice. Mitigation: a version gate, the `UserPromptSubmit` confirmation, the PTY fallback, and a manual check of this harness when the Claude Code version changes.
2. **Failures are silent.** Delivered, held, refused, `session_id` mismatch, retired worker: the sender sees the same thing (Q1, Q5). Only the confirmation tells them apart, and only as "confirmed" versus "not confirmed".
3. **Workers retire when idle.** Seen after 3 to 5 minutes under low memory. Then the session has no pipe, and held messages are lost. Waking costs time and, through `claude attach`, a model-written recap (M1 spike, surprise 10).
4. **Other senders.** With `accept`, every other Claude session of the user on this machine can message an Orchtopus session, and so can any process of the user that reads the registry `.key` file. A message cannot approve a permission (docs), but it can steer the model. The adapter shows unknown `UserPromptSubmit` texts in the session feed. Docs: deny rules on `SendMessage` and `ListAgents` stop our own sessions from sending.
5. **Hooks cannot tell a peer message from a typed prompt** (Q4). Any rule that reads `UserPromptSubmit` as "the user typed" must check the adapter's send log first.
6. **The token is a secret.** It is in the environment of every hook and Bash command of the session, so the model's Bash can read it. Our hook hands it to the local API; never log it, never write it to disk, never put it into the event log.
7. **Usage.** Every delivered message is a model turn. Orchtopus sends; sessions do not relay messages to each other automatically. Docs: the receiver throttles repeats and keeps at most 50 accepted and 100 held messages.
8. **Not tested:** a bypassing receiver, the mode-based hold dialog and its release, `priority`, `from` and reply addresses, `file_attachments`, `-p` sessions, `notify_when_idle`, a new token after compaction, throttling and queue limits, retirement without memory pressure, and how long a busy session waits during a long model response.
