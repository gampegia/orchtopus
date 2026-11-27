# Orchtopus design: Lagoon

This file records the design direction for Orchtopus. It is the reference for every screen and component.

- Living example: `docs/design/reference/lagoon.html` (1440 × 900, `#screen=1-4&mode=light|dark`, settings sub-page `&page=octopus`, keys `1`–`4` and `D`).
- Tokens: `docs/design/reference/lagoon.tokens.json`. It mirrors the `THEME TOKENS` block of the reference file one to one.
- History: `docs/design/explorations/` (see section 14).

## 1. Direction

| | |
|---|---|
| Product | A Windows desktop app that runs and supervises several Claude Code sessions, so one person sees in three seconds what each session does, what comes next and where they are needed. |
| Character | Calm, watchful, a little playful. |
| World | A lagoon. Light mode is the surface by day, dark mode is the same place under water at night. Opaque panels float over it like islands. |
| Highlights | The decision card, which carries the one signal colour on screen, and the scene light, which takes the colour of the overall state. |
| Signature | The octopus: one pixel mantle heads the session list, one arm runs to each session's lamp, and the selected session's arm reaches into the decision card. |

What the design must never become:

- A dashboard of equal tiles, or a wall of cards nested in cards.
- A light show. Glows, pulses and colour that carry no state.
- A game. The octopus and the scene stay small, switchable and behind the work.
- A place where colour alone says something. Every signal has a word.

## 2. Principles

1. **Three-second answer.** Without a click the window answers: what is each session doing, what comes next, where am I needed. The session list, the title-bar note and the status bar each say it in words.
2. **The session view is home.** The session list is always visible on session screens. Other views (review, settings) are detail views with a way back.
3. **One dominant decision, one primary action.** At most one decision card per screen. It holds exactly one primary button. Everything else that waits goes into the Then strip.
4. **Colour is for signals only.** Surfaces, text and borders are tinted neutrals. Colour appears where it means something, and always next to a word.
5. **Scenery is background.** The scene shows in the title band, in the gaps and below the session list. It never sits behind running text and never competes with a signal.
6. **Calm under load.** Ten sessions look as quiet as two. Nothing loops for attention. Changes animate once, briefly, and only when the change carries meaning.

## 3. Signal colours

Every signal carries a text label ("Needs you · permission", "Danger", "PR draft"). A theme may shift hue and lightness, never the meaning. A new theme must keep every signal at 4.5:1 or more on the panel, on the selected row and on the decision tint.

Contrast measured in the reference file (WCAG 2.x ratio). "Tint" is the decision card background: the signal mixed into `surface.panel` at `mix.decision-fill` (6 % light, 8 % dark).

| Signal | Meaning | Light | Dark | Light on panel / tint / selected | Dark on panel / tint / selected |
|---|---|---|---|---|---|
| `signal.permission` | Permission waits, needs you | `#8a5a00` | `#f2b84b` | 5.78 / 5.31 / 5.24 | 10.13 / 9.00 / 8.61 |
| `signal.plan` | Spec or plan waits | `#6a4bc4` | `#b9a3f7` | 5.99 / 5.48 / 5.43 | 8.33 / 7.46 / 7.08 |
| `signal.done` | PR draft, ready, done | `#1a7046` | `#62d39c` | 5.93 / 5.43 / 5.38 | 9.77 / 8.66 / 8.31 |
| `signal.danger` | Dangerous command, stalled | `#b42828` | `#ff7a7a` | 6.25 / 5.72 / 5.67 | 7.18 / 6.50 / 6.10 |
| `signal.overlap` | Two sessions touch the same files | `#a24915` | `#ff9d57` | 5.85 / 5.36 / 5.30 | 8.82 / 7.88 / 7.49 |
| `signal.running` | Running | `#1f62b8` | `#72b8ff` | 5.85 / 5.38 / 5.31 | 8.65 / 7.73 / 7.35 |
| `signal.idle` | Idle (neutral, ring lamp) | `#5a6773` | `#8592a5` | 5.65 / 5.17 / 5.12 | 5.74 / 5.25 / 4.88 |

Rules:

- A signal colour appears as a lamp (dot), a short label, an arm, the decision card's edge and tint, or a terminal warning line. Never as a large fill.
- Idle uses a ring lamp, not a filled one, so it reads apart from the others without colour.
- Gadgets, styles and scenery never use signal hues (see sections 7 and 8).

## 4. Tokens

Names are dotted in JSON and hyphenated in CSS: `surface.page` is `--surface-page`. The first segment is the group. Components use tokens only; no hard-coded colour, radius, spacing or font. Component dimensions that occur once (a 168 px select, a 144 × 84 preview) may stay in the component; anything shared is a `size.*` token.

### Surfaces, text, borders, accent

| Token | Purpose | Light | Dark |
|---|---|---|---|
| `surface.page` | Window background without scenery (plain variant) | `#e3e7e5` | `#0a0f17` |
| `surface.panel` | Panels (islands), cards, status bar | `#fdfcf9` | `#0f1622` |
| `surface.inset` | Inputs, segmented controls, tiles | `#f3f1eb` | `#151e2c` |
| `surface.raised` | Secondary buttons, bars | `#ece9e1` | `#1b2535` |
| `surface.hover` | Row and item hover | `#f3f1ec` | `#151e2b` |
| `surface.selected` | Selected row or nav entry | `#edf2f0` | `#1b2535` |
| `surface.terminal` | Terminal and command boxes | `#f8f7f2` | `#0a0f18` |
| `text.primary` | Body, names, values | `#17212a` | `#e6ecf3` |
| `text.secondary` | Labels, descriptions | `#45535f` | `#a6b1c1` |
| `text.muted` | Meta, counts, icons | `#5a6773` | `#8592a5` |
| `text.terminal` | Terminal output | `#1f2a33` | `#d3dae5` |
| `border.subtle` / `border.strong` / `border.panel` | Hairlines, input borders, panel edge | text at 9 / 17 / 6 % | text at 8 / 15 / 7 % |
| `accent.default` | Focus, selection icon, switches. Sea-glass teal | `#2a6f69` | `#8cc7bf` |
| `accent.contrast` | Thumb on an accent switch | `#fdfcf9` | `#0a0e16` |
| `action.primary` / `action.on-primary` | Primary button fill and label (15.9:1 / 16.2:1) | `#17212a` / `#fdfcf9` | `#e6ecf3` / `#0a0e16` |

Text contrast on `surface.panel`: primary 15.9 (light) / 15.3 (dark), secondary 7.7 / 8.4, muted 5.7 / 5.7. Muted on `surface.raised` is the weakest pair: 4.8 / 4.9.

### Shape, space, type

| Group | Tokens |
|---|---|
| Radius | `radius.key` 4 · `radius.small` 6 · `radius.control` 8 · `radius.bar` 10 · `radius.window` 12 · `radius.panel` 16 · `radius.round` 50 % |
| Space (4 px grid) | `space.0-5` 2 · `space.1` 4 · `space.1-5` 6 · `space.2` 8 · `space.3` 12 · `space.4` 16 · `space.5` 20 · `space.6` 24 · `space.8` 32 · `space.10` 40 · `space.12` 48 |
| Layout | `layout.edge` 16 · `layout.gap` 16 · `layout.gap-inner` 12 · `layout.icon-gap` 10 · `layout.list-inset` 40 · `layout.lamp-x` 48 · `layout.mantle-inset` 10 |
| Size | `size.titlebar` 48 · `size.statusbar` 32 · `size.sidebar` 264 · `size.rail` 312 · `size.header` 64 · `size.strip` 40 · `size.row` 52 · `size.nav-row` 36 · `size.list-row` 28 · `size.control` 36 / `-small` 32 / `-tiny` 28 · `size.command` 44 · `size.keycap` 18 · `size.icon` 16 / 14 / 12 · `size.lamp` 8 / 6 |
| Lines | `border.width` 1 · `border.width-strong` 2 · `icon.stroke` 1.5 · `arm.stroke` 1.5 · `arm.reach-stroke` 2 · `focus.width` 2 · `focus.offset` 2 |
| Fonts | `font.ui`: Figtree, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif · `font.mono`: JetBrains Mono, Cascadia Mono, Consolas, monospace |
| Type size / leading | `type.micro` 11/16 · `type.meta` 12/16 · `type.small` 13/20 · `type.body` 14/20 · `type.title` 16/24 · `type.heading` 20/28 (`leading.*`) |
| Weight | `weight.regular` 400 · `weight.medium` 500 · `weight.strong` 600 (signal labels, rare emphasis) |

Monospace only for commands, paths, branches, counts and terminal output. Numbers use tabular figures.

### Shadows, mixes, layers

| Token | Light | Dark |
|---|---|---|
| `shadow.panel` | 1 px edge at 6 %, `0 1px 2px` and `0 8px 24px` soft neutral | 1 px edge at 7 %, `0 8px 24px` black at 32 % |
| `shadow.row` | `0 1px 2px` neutral at 8 % | inset top highlight, white at 5 % |
| `shadow.highlight` | none | inset top highlight on buttons |
| `shadow.window` | edge plus `0 24px 64px` | `0 24px 64px` black at 60 % |
| `mix.decision-fill` / `mix.decision-edge` | 6 % / 40 % | 8 % / 40 % |
| `mix.hold-fill` / `mix.hold-edge` / `mix.hold-progress` | 12 % / 55 % / 34 % | same |

Z layers: `z.scene` 0 · `z.content` 1 · `z.arms` 5 · `z.popover` 20 · `z.overlay` 30 (command palette, dialogs) · `z.toast` 40.

Octopus, scene and motion tokens are listed in sections 7, 8 and 9.

## 5. Layout

The main window (reference 1440 × 900, minimum 1100 × 700):

| Region | Size | Behaviour |
|---|---|---|
| Title bar | 48 high, on the scene | Brand head, breadcrumb, state note (one line: who needs you), Inbox, Settings, window controls. Draggable. |
| Session list | 264 wide (`size.sidebar`), height of its content, max full height | Mantle with one arm per session, grouped by project. Resizable 224–360. Scrolls inside; arms of rows scrolled away stop at the list edge so a waiting lamp stays visible. |
| Session header | 64 high | Name, state word with lamp, branch; Pause, Explorer, VS Code, Terminal. |
| Decision card | Natural height, at most half the column | One per screen. The selected session's arm reaches its left edge. When nothing waits, it is gone and the terminal takes the space. |
| Then strip | 40 high, under the card | Names what waits next (lamp, session, state word) and one quiet line about the rest. Truncates, never wraps. |
| Terminal | Fills the rest of the column | Opaque. Live output of the real session. |
| Info column | 312 wide (`size.rail`) | Progress, workflow phases, session facts, side chat with the octopus next to the input. Below 1280 px window width it collapses to a toggle in the session header. |
| Status bar | 32 high, 12 from the bottom | Left: state counts with lamps, connection, Git age. Right: key hints for the current screen. |

Gaps: 16 between panels, 12 inside a column. Split panes (list, main, info) use react-resizable-panels; sizes persist per window.

Detail views keep the session list:

- **Review** (`screen=3`): header with Back, title, state, branch, and links (Diff, Session history, VS Code), then three columns: PR draft (404, the decision, reached by the arm) · What was done and Gates (392) · Git check and Advisor (rest). Each column keeps spare height at 1440 × 900 (about 48 px in the middle, 40 px in the advisor).
- **Settings** (`screen=4`): navigation panel instead of the session list, one content panel with two columns. Sub-pages: Appearance (look, variant, scenery, usage, models per role, a link to the octopus) and Octopus (`&page=octopus`).

## 6. Components

| Component | Anatomy | States and rules |
|---|---|---|
| Session row and arm | Name (14/500), progress (mono 12), state word in its signal colour; arm from the mantle to a lamp at `layout.lamp-x` | Hover: `surface.hover`. Selected: `surface.selected` + `shadow.row`. Waiting rows get a soft halo behind the lamp (not animated). Idle uses a ring lamp. Click selects; no press scale on list rows. |
| Decision card: permission | Signal label (lamp + "Permission"), title, wait time and fallback, command box, what it does, facts with icons, actions | Primary "Allow once" (Enter), "Always allow in this project", "Deny" (Esc), ghost "Ask the advisor". |
| Decision card: danger | Alert icon + "Danger", command, consequences, facts | Only the hold button allows. "Deny" (Esc). Hint with lock icon: "Not available by hotkey or remote". No "always allow". |
| Decision card: PR draft | Label + "Not created yet", title field, target branch, Draft PR check, editable description, actions, never-merges note | Primary "Release and create PR", secondary "Regenerate". |
| Decision card: spec or plan | Violet label "Plan" or "Spec", title, summary, link to the full document | Primary "Approve", "Ask for changes", ghost "Ask the advisor". |
| Hold-to-allow button | Danger-tinted button, label "Hold to allow once", "1 s" | Pointer only. Fill grows left to right in 1000 ms linear; release before the end snaps back in 200 ms. Enter and Space do nothing. After success: "Allowed once · sent to <session>". |
| Then strip | "Then" (muted), items (lamp, name, state word), rest line | Items are buttons that open that session. Never more than three items; the rest is one sentence. |
| Terminal frame | 40 header (icon, title, mono meta, open button), mono body 13/20 | Opaque `surface.terminal`. Warning lines take the signal colour. No smooth scroll. |
| Gates track | Rows of 28: mark, name, result right-aligned; council detail indented under its gate | Passed: check in `signal.done`. Note: info icon, secondary. Open: ring lamp. The open decision gate uses its signal colour. |
| Status bar | Counts (lamp + "1 needs you"), connection, Git age, key hints | Counts always in words. Hints change per screen; the danger screen shows the lock hint instead of a key. |
| Keycap | Mono 11, 18 high, 1 px border, 2 px bottom border, `radius.key` | Inside buttons at 65 % opacity. Used for every shortcut, never as decoration. |
| Lamp | 8 or 6 px dot in `currentColor` | Always next to a word. Ring for idle and open. |
| Tabs and segmented control | `surface.inset` track, 28 high buttons | Selected: `surface.panel` + `shadow.row`. Colour change only, no sliding indicator. |
| Buttons | 36 high (32 small), `radius.control`, 16 side padding | Primary: `action.primary`. Secondary: `surface.raised` + hairline. Ghost: no fill, secondary text. One primary per card. Press: scale 0.97. |
| Inputs | 36 high, `surface.inset`, `border.strong` | Focus: border `focus.ring`. Placeholder in muted text. |
| Switch | 36 × 20, `radius.bar` | On: `accent.default`. Thumb moves in 200 ms. |
| Focus ring | 2 px `focus.ring`, offset 2 | On every focusable element, keyboard only (`:focus-visible`). |
| Toast | Panel at bottom right above the status bar | Sonner. Confirms an action that left the screen ("PR draft created on GitHub · Open"). Never for errors that need a decision. |

## 7. The octopus

A small character with some wit. It repeats what the text already says, never covers content and can be switched off completely.

### Where it appears

| Place | Form | Animates |
|---|---|---|
| Session list header | Mantle only (16 × 9), the root of the arms | No. It changes face when a dangerous command waits (wide eyes). |
| Title bar | Mantle at 1.5 px per cell | No |
| Next to the side-chat and advisor input | Full octopus with gadgets | Yes, the only one on a screen |
| Settings | Sleeping in the Appearance summary; preview, style tiles and gadget icons on the Octopus page | Only the preview |

### States and triggers

| State | Trigger (the session you look at) | Frames |
|---|---|---|
| Waving | A permission or a plan waits | Arm up, arm tilted; two waves, then a rest of 2.75 s |
| Alarmed | A dangerous command waits, or the session stalled | Wide eyes; every 3.5 s a short tremble of the side arms |
| Content | All gates passed, a PR is ready, or the session runs without needs | Still most of the time, an arm sway every 2 s, a blink every 5.6 s |
| Sleeping | Nothing needs you; also in settings | Slow breath: the mantle rises one cell, the "z" shrinks, 1.5 s each |

### Format

The character is a versioned building block: `pets/<name>/pet.json`, optional `pets/<name>/sprites/*.png` sheets for later formats. The reference file embeds the same structure as `PET`.

| Field | Content |
|---|---|
| `name`, `version`, `format` | `orch`, `1.0.0`, `pixel-grid/1` |
| `grid`, `pad` | 16 × 16 cells; 3 empty rows above for hats. Rendered at 2 px per cell (32 × 38) next to inputs |
| `fps` | 8 (6–10 allowed). A tick is 125 ms |
| `slots` | One letter per palette slot. `b` body, `s` shade, `e` eye, `g` glint, `d` mouth, `z` sleep mark come from the style; `x` gear light, `y` gear dark, `w` gear accent come from the theme (`octopus.gear-*`). `.` is empty |
| `frames` | Named grids of strings, one character per cell |
| `states` | `sequence`: list of `[frame, ticks]`; `anchors`: `head`, `face`, `hand` cell positions; optional `frameAnchors` per frame |
| `gadgets` | `slot` (head, face, hand), `anchor`, `offset` (where the gadget's top-left cell lands relative to the anchor), `pixels`, optional `auto` (the session context that shows it by itself) |
| `styles` | Palette sets for the style slots, one per mode |

Rendering is one function: `{ style, gadgets, state, frame } → pixels`. The base frame is drawn first, gadgets are composited on top in slot order (head, face, hand). One gadget per slot. Auto gadgets win their slot while their context lasts; otherwise the user's choice shows.

### Styles and gadgets

| Style | Idea |
|---|---|
| Sea-glass | Default. Uses the theme's `octopus.*` tokens |
| Ink | Graphite-ink body, pale eyes |
| Sand | Warm sand |
| Pearl | Pale shell |
| Mimic | Takes the colour of the panel, like a mimic octopus. Low contrast on purpose; decorative only |

Coral was considered and rejected: it reads as danger or overlap. No style or gadget uses a signal hue.

| Gadget | Slot | Shows |
|---|---|---|
| Hard hat | head | Auto while the session is in Execute (a build runs) |
| Reading glasses | face | Auto in review |
| Party hat | head | Auto for a few seconds after you release a PR |
| Sleep cap | head | Auto when nothing needs you |
| Headset | head | User choice: supervising sessions |
| Coffee mug | hand | User choice: long days |
| Rubber duck | hand | User choice: for debugging out loud |

### Settings

Octopus page: Show the octopus (on/off) · Gadgets follow the session state · Reduce animation (still image; on by itself when Windows reduces motion) · Style tiles · Gadget toggles (auto gadgets can be disabled, user gadgets share their slot) · Live preview with a state picker · a table of triggers.

### Files and user additions

```
<app resources>/pets/orch/pet.json            shipped, read-only, versioned with the app
<app resources>/pets/orch/sprites/*.png       optional
%APPDATA%\Orchtopus\pets\user\<name>\pet.json user additions, never overwritten by updates
%APPDATA%\Orchtopus\settings.json             chosen pet, style, gadgets, switches
```

A user file with the same `name` as a shipped pet extends it (extra styles or gadgets); it cannot change shipped frames. Files are validated on load (grid size, known slots, offsets inside the padded grid); an invalid file is skipped with a notice.

### Add a style or a gadget in three steps

Style:

1. Add `styles.<id>` with `light` and `dark` palettes for `b s e g d`.
2. Run the check: every slot set, no signal hue, eyes at least 3:1 against the body.
3. Add the label; the style appears in the picker.

Gadget:

1. Draw `pixels` with `x y w` on a small grid and pick `slot` and `anchor`.
2. Set `offset` so it sits right on every state (check all four in the preview).
3. Optionally set `auto` to a session context (`execute`, `review`, `released`, `idle`); add `label` and `note`.

### Limits

- No brand mascots, logos or real characters.
- Never covers content, never sits on a decision card, never speaks in the UI.
- One animated octopus per screen. Idle life only: no move that asks for attention.
- Fully switchable off. Off removes it everywhere; the session list keeps a faceless mantle because the arms need a root.
- "Orch" naming is fine where it stays clear (the pet file is `orch`); UI labels stay plain ("Octopus").

## 8. Scenery and state light

| | Light: the lagoon by day | Dark: the same place at night |
|---|---|---|
| Scene | Sky, a few flat clouds, distant islands on the horizon, water, a sand bar at the lower left | Deep water, faint light shafts, the island's base from below, kelp under the session list, a sandy floor |
| State light | A low sun on the horizon at the lower left and its reflection | Bioluminescent lamps on the floor at the lower left |
| Tokens | `scene.sky-*`, `scene.cloud*`, `scene.far*`, `scene.water-*`, `scene.sand`, `scene.shallow`, `scene.ripple*` | `scene.deep-*`, `scene.shaft*`, `scene.ridge`, `scene.floor*`, `scene.kelp`, `scene.snow*` |

The overall state tints the light: `scene.light-wait` (amber family) when something needs you, `scene.light-danger` (red family) when a dangerous command waits or a session stalled, `scene.light-calm` otherwise. Opacities come in two sets, `-alert` and `-calm`. The light is always repeated in words by the title-bar note and the status-bar counts; it never stands alone.

Limits:

- Never behind running text. The scene shows in the title band (labels sit on it at 5.2:1 or more), in the gaps and under the session list.
- Low contrast: no scene shape is stronger than a hairline against its neighbours.
- No `backdrop-filter`. Panels are opaque; blur behind them would cost GPU time all day for nothing.
- Under Windows "reduce motion" the scene still changes colour, but without the 700 ms transition.
- Settings, Appearance: a Scenery switch. Off gives the plain variant (`surface.page` behind the panels) from the same tokens. The variant picker offers "Lagoon plain" as the same switch.

## 9. Motion

Motion confirms, explains a change of place, or bridges a jump. Nothing loops for attention except the octopus's small idle life. Keyboard actions get no animation. Reduced motion keeps fades and drops movement.

### Tokens

| Token | Value | Use |
|---|---|---|
| `motion.ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Entering, leaving, press |
| `motion.ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Moving on screen: arm reach, scene light |
| `motion.ease-hover` | `ease` | Colour and hover changes, toasts |
| `motion.fast` | 140 ms | Press, hover, screen fade |
| `motion.medium` | 200 ms | Release, counts, lamp colour, switches |
| `motion.enter` / `motion.exit` | 240 / 160 ms | Decision card in and out; exits are shorter |
| `motion.reach` | 180 ms | Arm drawing toward the card |
| `motion.toast` | 400 ms | Toast in and out |
| `motion.scene` | 700 ms | State light |
| `motion.hold` | 1000 ms | Hold-to-allow fill (linear) |
| `motion.step` | 80 ms | Offset between lead and support in a group |
| `motion.rise` / `motion.rise-small` | 8 / 4 px | Distance of an entrance or a count change |
| `motion.press-scale` / `motion.enter-scale` | 0.97 / 0.985 | Press feedback, card entrance |
| `motion.pet-fps` | 8 | Octopus frame rate |

### What animates, how, why

| What | How | Why |
|---|---|---|
| Buttons, tiles, chips, switches, nav entries | `:active` scale 0.97, 140 ms ease-out; hover is a colour change only | Feedback: the press was heard |
| Hold-to-allow | Fill `scaleX` 0 → 1 in 1000 ms linear while held, button at 0.97; release snaps back in 200 ms | Progress must not ease; slow where you decide, fast where the system answers |
| Decision arrives | Arm draws from the lamp (0–180 ms, stroke offset); halo pops (0–240 ms); card rises 8 px and fades in (80–320 ms); Then strip fades in (160–360 ms) | Spatial: the decision comes from that session. One gesture, lead first |
| Decision resolved | Card and arm leave together in 160 ms; the card stops taking space at once, Then strip and terminal close the gap in 240 ms (FLIP on transform, terminal clipped at the bottom) | No hole, no wait for the gap to close |
| Lamp changes state | Colour crossfade 200 ms; the arm lamp settles from 1.6× with a fade in 240 ms, once | State indication, once per change |
| State words, title note, hold label | Crossfade 160 ms, opacity only | Prevents a jarring swap of text |
| Status bar counts | A changed count rises 4 px and fades in, 200 ms; unchanged counts stay still | Shows what changed without a highlight |
| Screen or settings page via pointer | New view fades in, 140 ms, opacity only | Softens the cut; no movement on a daily action |
| Scene light | Stop colours and opacity, 700 ms ease-in-out | Ambient; the words already changed |
| Toast | Rises from 16 px below and fades, 400 ms `ease`, out the same way | Spatial: it comes from and leaves to the same edge |
| Octopus | Frame sequences at 8 fps with long holds; a still image when hidden, reduced or off | Character, not attention |

Never animated: anything triggered by a key (screen keys, Enter, Esc, D, command palette), the mode switch (all transitions are suppressed for one frame), terminal output and scrolling, list reordering, focus rings, tooltips after the first one, menus opened by keyboard.

Implementation rules:

- `transform` and `opacity` only. Two documented exceptions: the arm's `stroke-dashoffset` (one small SVG path) and the scene's stop colours (background, 700 ms, rare).
- CSS transitions for hover, press and toggles (interruptible). WAAPI for arrivals and exits, so they run off the main thread and can be cancelled when the next event comes.
- Every sequence stops what is running before it starts. No `transition: all`.
- Reduced motion: `motion.rise` 0, `motion.press-scale` 1, `motion.step` 0; WAAPI keyframes keep only opacity; the octopus shows a still frame; the scene changes without transition.
- Frame clock for the octopus: one timer, paused when the window is hidden or minimised.

## 10. Accessibility

- Text contrast at least WCAG AA (4.5:1) in light and dark, measured in all screens of the reference file. Weakest text pair: muted on raised, 4.78 (light).
- State is never shown by colour alone: every lamp sits next to a word, idle is a ring, danger has an icon, the scene light is repeated in the title note and the status bar.
- Everything works by keyboard: screens, rows, actions, settings. Shortcuts are shown as keycaps where they apply. Focus is visible on every element (2 px `focus.ring`, offset 2).
- **Dangerous commands can be allowed only with the held button in the app.** Never by hotkey, never by the API for remote clients, pad or watch. The button ignores Enter and Space. The hint "Not available by hotkey or remote" is always visible next to it.
- The octopus and the scene are `aria-hidden`; the octopus has a title that names its state for pointer users.
- Windows "reduce motion" and a high-contrast mode are respected; a high-contrast theme is a theme folder like any other.

## 11. Theme structure

```
themes/
  lagoon/
    tokens.json     light and dark maps (this repo's lagoon.tokens.json)
    effects.css     optional: scenery SVG layers, shadows that need more than a token
    preview.png     picker image, 288 × 168
  <name>/
    tokens.json
    ...
```

- Components use tokens only. A theme is a folder; adding one adds no code.
- `tokens.json` holds `name`, `version`, `light` and `dark`. Every theme defines every non-scene token in both modes; `scene.*` is optional and belongs to `effects.css`.
- On add, an automatic check runs: all required tokens present, text roles at 4.5:1 on their surfaces, every signal at 4.5:1 on panel, selected and decision tint, signal hues kept apart from each other. A theme that fails is not offered.
- Lagoon is the default theme. The plain variant is Lagoon without `effects.css` (scenery off): same tokens, `surface.page` behind the panels.
- Octopus styles live with the pet (`pets/`), not with themes; the default style takes its colours from the theme.

## 12. UI libraries

Chosen with the user:

| Library | Use |
|---|---|
| base-ui | Unstyled accessible primitives: dialog, popover, menu, select, switch, tabs, tooltip, checkbox |
| cmdk | Command palette (Ctrl+K), no open or close animation |
| Sonner | In-app toasts |
| zustand | UI state (selection, panes, settings, octopus state) |
| shiki | Code highlighting in diffs and descriptions, with themes built from the tokens |
| Plain CSS with CSS variables | All styling; no Tailwind |
| react-resizable-panels | Split panes (session list, main, info column) |

Later, as needed: Virtuoso (long lists and logs), dnd kit (reordering), recharts (usage charts), motion (only if a gesture or a layout animation needs springs; CSS and WAAPI cover everything in section 9).

## 13. unslop checklist result

Passes:

- Direction written; every pass followed it (spacing, colour, icons, copy, type, layout, details, visuals, motion).
- 4 px grid; equal things have equal sizes (rows 52, controls 36, gates 28).
- One neutral ramp tinted toward water, three text roles, one accent (sea-glass) used for focus, selection and switches.
- No hue gradients on surfaces, no gradient text, no glows, no coloured shadows.
- No emoji. One icon set (Lucide strokes, 1.5) at 16, 14 and 12.
- Figtree 400–600, sentence case, no uppercase tracked labels, no italic.
- No exclamation marks, no trailing periods on labels, no greeting headline, no claims.
- Tabular figures, one number format.
- Nested radii add up (panel 16 with 20 padding holds 8 controls).
- One primary action per card; buttons share the control radius.
- Template check: swap the name and the octopus, the arms and the lagoon still say "this is Orchtopus".

Broken on purpose:

- **Gradients and a coloured light in the scenery.** The scene is the product's world and carries the overall state. It is background only, never behind running text, low contrast, and can be turned off.
- **A looping idle animation.** The octopus has a small life at 8 fps with long holds. It is the one living thing on screen, still under reduced motion, and switchable off.
- **More than one hue in the chrome.** The six signal colours carry meaning and always come with words.
- **Off-grid 10 px** for the icon gap and the mantle inset: it aligns 16 px icons with the text start and the arms with the mantle cells.
- **Window radius 12 under panel radius 16.** The panels float as separate islands, not nested inside the window corner.

## 14. Credits and history

- Design pass with the **unslop** skill by Damir Sokolovsky (@heydamir), https://github.com/heydamir/unslop, licensed CC BY 4.0.
- Motion decisions follow the animate, emil-design-eng, choreograph and animation-performance skills (Emil Kowalski's animation philosophy).
- Fonts: **Figtree** (Erik Kennedy, SIL Open Font License 1.1) and **JetBrains Mono** (JetBrains, SIL Open Font License 1.1). Fallbacks: Segoe UI Variable and Segoe UI (Windows system fonts), Cascadia Mono (Microsoft, SIL OFL 1.1), Consolas. In the product, bundle the two OFL fonts with their licence files instead of loading Google Fonts.
- Icons: Lucide (ISC licence).
- History: the explorations live in `docs/design/explorations/`. Round 1: eight directions (`01`–`08`). Round 2: three variants (`r2-a-deep-sea`, `r2-b-lagoon`, `r2-c-tide-pool`). Chosen: R2-B Lagoon, with the pixel octopus from R2-A and the Then strip from R2-C.
