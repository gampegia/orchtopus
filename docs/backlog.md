# Backlog

Ideas that are not part of a milestone yet. Each entry says what it is, what was found out, and what it would need. An idea moves into a milestone spec only after the user says so.

## Plans and specs that are quick to review

Added 2026-11-27. Status: idea, to be evaluated.

**Problem:** plans and specs that the user must approve are often long, dense and tiring to read (the M1 plan has about 750 lines). A long review is easy to put off or to skim, and then the approval means little.

**Idea 1, smaller review packages:** split what the user must read into short parts, for example several 2-minute reads instead of one long one. Possible shapes:

- A one-page summary per plan for the user (what gets built, what the risks are, which decisions are the user's), with the full plan kept for the agents.
- Approval per part (for example per group of tasks or per milestone phase) instead of one approval for everything.
- Only the parts that need a human decision are marked for review; the rest is "for information".

**Idea 2, nicer presentation:** show plans and specs so they are pleasant to read: rendered page with headings, short sections, diagrams of the flow, progress per task, colour labels that say what needs the user (red) and what is information (green), collapsed details.

**Where it applies:**

- Our own workflow in this repository (the lead's specs and plans).
- The product: the spec and plan view of M3 (F38 to F41, F50) shows superpowers plans to the user. The same ideas would make that view better.

**To evaluate:** whether smaller approvals still catch cross-task problems; how much extra work the summary costs per plan; whether superpowers' plan format allows a separate user summary without changing the skill; which presentation (rendered Markdown in the app, an artifact page, a generated HTML file) fits best.

## Logitech MX Master 4 integration

Added 2026-11-27. Status: idea, researched once.

**What:** use the mouse as a second signal and input for "needs you": a short haptic pulse when a session needs the user, different patterns per kind of event, and mouse buttons or Actions Ring entries for quick actions (open inbox, next session that needs me, allow once, deny).

**What the research found** (sources checked on 2026-11-27, to be checked again before building):

- The MX Master 4 has a controllable haptic motor and the on-screen Actions Ring. Both depend on Logi Options+ and its plugin service running.
- Third parties integrate through the Logi Actions SDK. Plugins are written in C#; the Node.js SDK was discontinued. A plugin can define actions and raise haptic events that map to predefined waveforms. Custom waveforms are not offered. Plugins can be installed locally for personal use or published through Logitech's marketplace.
- A community plugin (HapticWeb, MIT) exposes the predefined waveforms over a local HTTP and WebSocket endpoint, so an app can trigger a pulse without writing its own plugin. It is a single-maintainer project.

**Possible steps, cheapest first:**

1. No code on the mouse side: Orchtopus offers global shortcuts for the quick actions (already planned as optional in F73); the user maps mouse buttons or ring entries to them in Logi Options+.
2. Haptics as a notification channel: a channel in the notification rule layer that calls a local haptic endpoint. Suggested mapping: one pattern for a permission, one for a stalled session, one for "ready for review".
3. Own plugin in C#: native Actions Ring entries with live state (for example the number of waiting decisions) and haptics without a third-party plugin.

**Fits the architecture because** every action already goes through the local API and notifications go through a rule layer with pluggable channels (E34).

**Rules that still apply:** a dangerous command can never be allowed from the mouse, only opened. Allow once for a normal permission from a mouse button needs the same care as a hotkey: only for the card that has the focus.

**Open:** licence terms of the SDK and the marketplace, how stable haptics are on Windows, whether the session that needs the user can be shown in the ring.
