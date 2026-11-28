# Review page template for specs and plans

Date: 2026-11-28
Status: draft, waits for the user's pick of a direction
Parent: `docs/backlog.md`, entry "Plans and specs that are quick to review" (user decision 2026-11-28). It replaces F50's rendered Markdown editor as the default view of the spec and plan view (F38). Design: `DESIGN.md` (Lagoon). Explorations: `docs/design/explorations/2026-11-28-plan-review/`.

## Intent

The user approves specs and plans on a designed HTML page instead of reading Markdown. The Markdown stays the agents' source of truth and is what gets committed. The page is a view of one revision of that Markdown.

- The session writes the page from a versioned template, through superpowers, after it writes or changes the Markdown.
- The page lives in the Orchtopus data folder and is never committed.
- Orchtopus shows it in the spec and plan view, with Spec OK or Plan Go next to it and the raw Markdown one click away.
- Orchtopus checks that the page belongs to the Markdown revision on disk. If it does not, Orchtopus shows the Markdown instead.

## Files

```
building-blocks/review-page/
  plan/<version>/template.html     fixed sections, styles, slots
  spec/<version>/template.html
  README.md                         how a session fills a template (read by the skill step)

%APPDATA%\Orchtopus\projects\<project-id>\reviews\<document-slug>\
  <sha256 of the Markdown, first 12>.html     one page per revision
```

- Templates are building blocks like the workflow instruction: versioned files, loaded at runtime (CLAUDE.md, architecture rules).
- A new revision gets a new file. Old pages stay until the document is approved or removed, so "what did I approve" can be shown later.
- With the project setting "Keep specs and plans in the repository" off, the Markdown also lives in the data folder. The page location does not change.

## Fixed sections

The template owns the order, the headings, the styles and the markup of each section. The session fills the slots. The three directions in the exploration differ in layout only; they share this section set.

| Order | Section (`data-review-section`) | Plan | Spec | Shown on the first screen |
|---|---|---|---|---|
| 1 | `summary` | What gets built (one headline, up to 3 lines), counts | Intent (one paragraph), not in scope | Yes |
| 2 | `needs` | Decisions that are the user's, each with options and a default | Calls the user can correct | Yes |
| 3 | `risks` / `done-when` | Risks and what the tests expect, the stop rule | Done-when list | Yes (risks); spec: first lines |
| 4 | `flow` | Lanes and waves | One flow diagram the spec needs (for M1: where a hook event goes) | Direction B: yes |
| 5 | `tasks` / `approach` | One collapsible row per task: what, after which tasks, agent, reviews, files, steps | Approaches with the chosen one marked, checks with fallbacks | No |
| 6 | `info` | Facts the user should know but need not decide | The same | No |
| 7 | `source` | Source path, sha256, template version (written by the template, filled by the session) | The same | Footer |

Rules for the fixed parts:

- Headings and labels are template text. "Needs you" always carries an icon and the words "Needs you"; "Info" always carries an icon and the word "Info". Colour is never the only signal.
- The template's style block uses design tokens only (`var(--surface-panel)` and so on). It never defines a colour, radius, spacing or font itself. Orchtopus injects the active theme, so the page follows Lagoon light and dark and any later theme.
- Collapsing uses `<details>`. Diagrams are HTML and CSS from template building blocks (lane grid, wave list, step chain). No Mermaid, no canvas, no SVG written by the session.

## What the session fills

| Slot | Content | Rule |
|---|---|---|
| Headline | One sentence: what the plan builds, or the spec's intent | From the Markdown's goal or intent; no new claims |
| Builds | Up to 3 lines | Shorter than the Markdown; each line traceable to a "Done when" item |
| Needs | Items with `id`, title, why, options, default, related task | Every item has a default, so Plan Go without answers is well defined. The session decides what is the user's; the rule is: product behaviour, security trade-offs, cost, and anything the spec left open |
| Info | Items with title and why | Decisions the user should see but need not make |
| Risks | Condition, expected behaviour, tasks that pin it | From the plan's review focus |
| Flow | Lanes and waves, or one spec diagram | Lanes and waves come from each task's "Consumes" line; a lane is one worktree, tasks in one wave run at the same time |
| Tasks | Number, title, one-line purpose, after which tasks, agent and effort, reviews, files, step names | One row per `### Task` heading, same numbers |
| Source | Path, sha256, template version | Written into the head and the footer |

The session never invents content the Markdown does not have. If a slot has nothing, the template shows "None" in that section, never an empty block.

## Markup contract

The page is static HTML that Orchtopus can check without a model.

```html
<html lang="en">
<head>
  <meta name="orchtopus:template" content="review-page/plan@0.1.0">
  <meta name="orchtopus:source" content="docs/plans/2026-11-27-m1-walking-skeleton.md">
  <meta name="orchtopus:source-sha256" content="2ac7d468bf17476d0ff2146670e390f5aa73e10a298876713d3fefc0a781c22d">
  <meta name="orchtopus:written" content="2026-11-27T18:40:00Z">
  <style>/* copied verbatim from the template */</style>
</head>
<body>
  <section data-review-section="needs" data-count="3">
    <div data-need="D6" data-default="keep">…</div>
  </section>
  <section data-review-section="tasks" data-count="17">
    <details data-task="4" data-steps="6" data-lane="1" data-wave="4" data-after="2 3">…</details>
  </section>
</body>
</html>
```

Not allowed in a page: `<script>`, event handler attributes, `<form>`, `<iframe>`, `<object>`, `<embed>`, external URLs (`http:`, `https:`, `//`), `@import`, inline `style` attributes with colours. Links are in-page anchors or `orchtopus:` links that the host handles (`orchtopus:markdown`, `orchtopus:task/4`).

## How Orchtopus checks the page

Orchtopus runs these checks when the view opens and whenever the Markdown or the page changes on disk (file watch). They are fast and need no model.

1. **Revision.** Read the Markdown as UTF-8, drop a BOM, turn CRLF into LF, compute sha256. Compare with `orchtopus:source-sha256`. A different hash means the page is older or newer than the Markdown.
2. **Structure.** Parse the Markdown deterministically and compare with the page's data attributes:
   - plan: number of `### Task N:` headings and their numbers against `data-task`; number of `- [ ] **Step` lines per task against `data-steps`;
   - spec: number of "Done when" items against `data-count` of that section;
   - both: every section in the fixed list is present once, in order.
   The hash proves which revision the page claims. The structure check catches a page that claims the right revision but left something out.
3. **Template.** `orchtopus:template` names a known template and a version Orchtopus supports (current and one before). The page passes the "not allowed" list above. The style block equals the template's style block byte for byte.

Results:

| Result | What the user sees | Spec OK / Plan Go |
|---|---|---|
| All checks pass | The page, with "Matches the Markdown · sha256 2ac7d468…" in the source line | Enabled |
| Revision or structure differs | The raw Markdown, with a line "The review page is older than the Markdown · Ask the session to rewrite it" | Enabled; it approves the Markdown on screen |
| Template check fails | The raw Markdown, with "The review page was not shown: <reason>" | Enabled, as above |

Approval binds to the Markdown, never to the page. The `spec.approved` or `plan.approved` event records the Markdown sha256, the page file name and the template version. If the Markdown changes after the approval, the approval is shown as "for an older revision" (F41 resets apply as today).

## Hosting

- The page renders in a sandboxed frame: `sandbox` without `allow-scripts`, `allow-same-origin`, `allow-forms` or `allow-top-navigation`; CSP `default-src 'none'; style-src 'unsafe-inline'; font-src app:; img-src data:`.
- Orchtopus builds the frame document from the page plus two injected blocks: the active theme's tokens, and an overlay style block for live state (`[data-task="7"] { --done: 3; --state: running }`). The template uses these properties for progress bars and step counts, so progress shows without rewriting the page during execution.
- Progress comes from the Markdown checkboxes at the current revision and from the event log. The page itself is not rewritten when a step is ticked.
- Every action is host chrome outside the frame: Spec OK, Plan Go, Ask for changes, the advisor, and the answer controls for "Needs you" items. A session writes the page, so the page must never be able to approve anything or look like it can. Where a direction shows answer controls next to a decision (direction C), Orchtopus renders them over the frame from the page's `data-need` items.
- The raw Markdown is always one click or the `M` key away.

## Who writes the page

- The session that writes the spec or plan writes the page right after, with a skill step that reads `building-blocks/review-page/README.md` and the template.
- It rewrites the page on every change of the Markdown before it reports the document as ready.
- The step runs on the session's own model; it is summarising and layout work. Its cost is measured per plan in M3 (open question from the backlog).

Considered and not chosen: Orchtopus renders the page itself from the Markdown. That removes the revision check, but a parser cannot write the summary, decide what needs the user, or derive lanes. The user decided that the session writes the page.

## Open

- **Direction.** A Brief, B Map or C Parts (the user picks).
- **Label colours.** The backlog asks for red "needs you" and green "info". DESIGN.md reserves red for danger and stalled and green for PR and done. The explorations show both: red and green as asked, or "Signal labels" (the document's own violet for "Needs you", neutral for "Info"). The user decides.
- Whether answers to "Needs you" items go to the session as one message with "Ask for changes" (proposed) or one by one.
- Per-part approval (backlog idea 1) is not part of this template. Direction C prepares for it.
