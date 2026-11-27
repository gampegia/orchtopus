# Backlog

Ideas that are not part of a milestone yet. Each entry says what it is, what was found out, and what it would need. An idea moves into a milestone spec only after the user says so.

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
