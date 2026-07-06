---
description: Seed world/ canon from handwritten/raw worldbuilding notes — run BEFORE the outline-enhancer
argument-hint: "[path(s) to note files or folder, e.g. ~/Downloads/world-notes/]"
---

Invoke the `world-notes-seeder` skill via the Skill tool. If the skill is not installed on this machine, read `skills/world-notes-seeder/SKILL.md` in this repo and follow its instructions directly.

Use it to:
- Transcribe handwritten/photographed/typed world notes faithfully (never guessing at illegible words).
- Classify facts into `world/` buckets, assign stable CHAR-NNN/THR-NNN IDs, and seed or extend the canon files.
- Reconcile against existing canon — contradictions get logged, never overwritten.
- Emit a seeding report with open questions for the author.

Run this BEFORE `/outline-enhancer` so the pipeline starts with world background.

Request: $ARGUMENTS
