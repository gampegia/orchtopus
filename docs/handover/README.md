# Orchtopus – handover pack

Everything needed to start building Orchtopus agentically. Copy this folder into the new repo as `docs/handover/` and start the lead session with `docs/KICKOFF-PROMPT.md`.

## Contents

| Path | What it is |
|---|---|
| `docs/concept.md` | Concept and requirements, translated from the German original. Source of truth for requirements (E = decisions, F = requirements). |
| `docs/IMPLEMENTATION-GUIDE.md` | Ground rules, proposed stack, milestones M0–M8, how to run the build with a lead and subagents, skills to install. |
| `docs/KICKOFF-PROMPT.md` | Prompt for the first lead session. |
| `templates/CLAUDE.md` | Starting point for the repo's `CLAUDE.md`. |
| `templates/agents/*.md` | Subagents with explicit models: implementer, spec-, code-, security-, ui- and privacy-reviewer. Copy to `.claude/agents/`. |
| `mockups/index.html` | Visual reference: four screens (session with permission, dangerous command, review detail with PR draft, settings) in five themes, dark and light. |
| `mockups/prototype.html` | Clickable behaviour simulation (older visual style). Flows only; pad, watch and simulation panel are out of scope. |
| `THIRD-PARTY.md` | Skills and tools referenced by the concept, with licences. |

## Notes

- Preferred visual directions: **Island Landscape** and **Tinted Glass**. **Stellwerk** is the calm default theme. All themes share one layout; only tokens and theme effects differ (E27).
- The concept mentions older mockup rows (v2, v3, layout variants). They are not part of this pack; the mockups here supersede them visually.
- All names in this pack are generic demo names.
- The pack was written under the working title "Leitstand". The product is now called Orchtopus; names and paths were updated and the concept was translated to English when the pack was added to this repository.
