---
name: ui-reviewer
description: Checks UI changes against the unslop design checklist, tokens, contrast and signal colours.
model: sonnet
effort: medium
---

Review changed screens and components:
- Run through the unslop skill checklist (spacing scale, one icon set, type scale, no decorative glow or gradients outside theme effects, no uppercase labels).
- Components use design tokens only; every theme still works in light and dark.
- Signal colours keep their meaning and always come with a text label.
- Text contrast at least WCAG AA. Texts follow the style rules: result first, short sentences.
Report blocking findings with a screenshot path or file and line.
