# Review page explorations, 2026-11-28

Three directions for the page on which the user reviews and approves specs and plans in Orchtopus. Template spec: `docs/specs/2026-11-28-review-page-template-design.md`.

Open `index.html` to compare all three side by side, or open one file full size.

| File | Direction | Where Spec OK / Plan Go sits |
|---|---|---|
| `a-brief.html` | **A · Brief.** One reading column like a memo. Waves run top to bottom. | Decision card in a rail on the right, with the page contents and the source check under it |
| `b-map.html` | **B · Map.** Summary band in three columns (builds, needs you, risks), then a lane map of the whole plan on the first screen. | In the view header, next to the state word |
| `c-parts.html` | **C · Parts.** The document is cut into parts of one or two minutes, read one at a time, with read marks. Decisions are answered in place. | Decision bar at the bottom of the view, with "Next part" and parts read |

## How to use the files

- Hash state: `#screen=1|2|3&mode=light|dark&labels=asked|signal`. Keys `1` to `3` switch the screen, `D` the mode.
- Screen 1: the M1 plan waits for Plan Go. Screen 2: the same plan while it runs (demo progress, not the real state of M1). Screen 3: the M1 spec waits for Spec OK.
- `labels=signal` shows "Needs you" in the document's violet and "Info" in neutral instead of red and green (open question in the template spec).
- Add `&shot` to hide the control bar for screenshots. `screenshots/` has three per direction.

## How the files are built

- `tokens.css` is the Lagoon THEME TOKENS block of `docs/design/reference/lagoon.html`, copied one to one. Every colour, radius, spacing and font in the three pages is a token.
- `chrome.css` and `explore.js` draw the Orchtopus chrome around the page (title bar, session list, view header, status bar) and the URL state.
- `data.js` holds the sample content from `docs/plans/2026-11-27-m1-walking-skeleton.md` and `docs/specs/2026-11-27-m1-walking-skeleton-design.md`, so all three directions show the same facts. The sha256 values are those of the two files at the time of writing.
- In the product the page is static HTML written by the session from the template (no script); here it is rendered from `data.js` to keep the three directions in step.
- Lanes and waves are derived from each task's "Consumes" line: a lane is one worktree, tasks in one wave run at the same time. The M1 plan text still says "strictly in order"; the page shows that as an info item.
- The "Needs you" items for the plan are taken from the plan's "Decisions for the lead to confirm" (D3, D6, D8) and for the spec from "Calls made by the lead" (2, 3, 7). Which items need the user is the session's call in the product; here it is the lead's sample choice.
- Scenery is off (Lagoon plain), so the comparison is about the page.

## unslop pass

Direction from `DESIGN.md` (Lagoon): calm, watchful, a little playful; colour only for signals; one decision per screen. The passes ran on all three files; the checklist result:

- 4 px grid, rows and controls from the size tokens. Equal things have equal sizes per direction (task rows 44 in A, map cells 40 in B and C).
- One neutral ramp, three text roles, accent only for focus and the selected answer (C). Violet only for "Plan" and "Spec", blue only for running, green for done, "chosen" and "Matches the Markdown", and in the default label mode red for "Needs you" and green for "Info".
- No gradients, glows, emoji, uppercase labels or italic. One icon set (Lucide strokes, 1.5) at 16, 14 and 12.
- Copy: sentence case, no exclamation marks, no trailing periods on labels, numbers in one format with tabular figures, mono only for paths, hashes, counts and commands.
- One primary action per screen (Plan Go or Spec OK). On the running screen there is none.
- Motion: colour change on hover, press scale, the chevron of a task row turns. Nothing loops.
- Template check: the lane map, the source line with the hash and the session list say "Orchtopus"; the pages would not fit another product.

Broken on purpose:

- **Red for "Needs you" and green for "Info"**, as the backlog asks. This collides with DESIGN.md's red (danger, stalled) and green (PR, done). The "Signal labels" mode shows the alternative; the user decides.
- **Direction A does not fit the risks on the first screen** at 1440 × 900; the headline, the builds and the three decisions take it. B and C show all three blocks on the first screen.
