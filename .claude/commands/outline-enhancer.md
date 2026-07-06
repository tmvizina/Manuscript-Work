---
description: The dramaturg — deepen a human sketch into an enriched outline (OB-NNN beats) while seeding world/ memory
argument-hint: "[path to the human sketch, or the premise/beats inline]"
---

Invoke the `outline-enhancer` skill via the Skill tool. If the skill is not installed on this machine, read `skills/outline-enhancer/SKILL.md` in this repo and follow its instructions directly.

Stage 0 of the generation half. Takes a premise/outline/beat sheet, deepens it into `outline/enriched-outline.md`, and seeds/augments `world/` (characters, threads, arcs with stable IDs). Marks unresolved questions campaign-pending rather than inventing answers. If `world/` was pre-seeded by `/world-notes-seeder`, it reads that first and augments — never contradicts.

Request: $ARGUMENTS
