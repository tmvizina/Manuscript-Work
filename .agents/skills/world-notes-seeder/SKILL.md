---
name: world-notes-seeder
description: Seed a project's world canon or nonfiction Knowledge Base from handwritten notes, field notes, interviews, photographs, and raw sources before outline development
---

# world-notes-seeder

When `.book-writer/project.json` selects nonfiction, also read [skills/nonfiction-profile.md](../../../skills/nonfiction-profile.md) and apply its overrides.

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/world-notes-seeder/SKILL.md](../../../skills/world-notes-seeder/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Use it to:
- Transcribe handwritten/photographed/typed world notes faithfully (never guessing at illegible words).
- Classify facts into `world/` buckets, assign stable CHAR-NNN/THR-NNN IDs, and seed or extend the canon files.
- Reconcile against existing canon — contradictions get logged, never overwritten.
- Emit a seeding report with open questions for the author.

Run this BEFORE `/outline-enhancer` so the pipeline starts with world background.
