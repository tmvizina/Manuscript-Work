---
name: outline-enhancer
description: The dramaturg — deepen a human sketch into an enriched outline (OB-NNN beats) while seeding world/ memory
---

# outline-enhancer

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/outline-enhancer/SKILL.md](../../../skills/outline-enhancer/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Stage 0 of the generation half. Takes a premise/outline/beat sheet, deepens it into `outline/enriched-outline.md`, and seeds/augments `world/` (characters, threads, arcs with stable IDs). Marks unresolved questions campaign-pending rather than inventing answers. If `world/` was pre-seeded by `/world-notes-seeder`, it reads that first and augments — never contradicts.
