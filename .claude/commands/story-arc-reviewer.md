---
description: The arc gate (human in the loop) — turn enriched arcs into AQ-NNN confirmation questions, record answers as canon, emit the validated outline
argument-hint: "[enriched outline to gate, or answers to record]"
---

Invoke the `story-arc-reviewer` skill via the Skill tool. If the skill is not installed on this machine, read `skills/story-arc-reviewer/SKILL.md` in this repo and follow its instructions directly.

Stage 0.5 of the generation half. Reviews the outline-enhancer's proposed arcs, asks the author the questions needed to confirm arc direction, records answers as canon in `world/`, and hands down `outline/validated-outline.md`. Not an autonomous approver — the author decides.

Request: $ARGUMENTS
