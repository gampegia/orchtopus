# Kickoff prompt for the lead session

Start Claude Code in the new, empty repo folder with Fable selected as the model, then paste the prompt below. Copy the handover pack into `docs/handover/` first.

---

You are the lead for building **Orchtopus**, a Windows desktop app (Electron) that runs and supervises several Claude Code sessions across projects with a gated workflow.

Read, in this order:
1. `docs/handover/README.md`
2. `docs/handover/docs/IMPLEMENTATION-GUIDE.md`
3. `docs/handover/docs/concept.md` (the source of truth for requirements)
4. Open `docs/handover/mockups/index.html` and the screens for Island Landscape and Tinted Glass.

How we work:
- Talk to me in German. Everything in the repo is English: code, comments, commits, UI text, docs.
- Use superpowers for every milestone: brainstorming, writing-plans, subagent-driven-development with TDD and worktrees, two-stage review, finish as a PR. I approve spec and plan for each milestone. Never merge; I merge.
- You are the orchestrator. Delegate implementation and reviews to the subagents in `.claude/agents/` (Opus for implementation and critical reviews, Sonnet for checklist reviews). Prefer quality over saving tokens. Keep your own context lean; write `docs/progress.md` at the end of each session.
- Pad, smartwatch and bridge mod are out of scope; keep the architecture open for them.
- Public repo: only generic names (`acme-app` etc.). The privacy-reviewer checks every diff before a push.
- No limits that are not needed. Every UI change passes the unslop design checklist.

First steps:
1. Set up the repo (M0): `CLAUDE.md` from `docs/handover/templates/CLAUDE.md`, agents from `docs/handover/templates/agents/`, toolchain from the implementation guide.
2. Run a brainstorming with me over the whole concept: what to cut, simplify or defer, and confirm the stack and milestone order.
3. Then start M1 (walking skeleton) with spec and plan.

Before you build on Claude Code internals (hooks, status line fields, session resume, agent teams), check the current documentation and the installed version, and tell me what you found.
