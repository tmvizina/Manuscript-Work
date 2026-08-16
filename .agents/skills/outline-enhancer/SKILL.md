---
name: outline-enhancer
description: Deepen a fiction sketch or nonfiction book concept into a structured outline while seeding the project's canon or Knowledge Base
---

# outline-enhancer

When `.book-writer/project.json` selects nonfiction, also read [skills/nonfiction-profile.md](../../../skills/nonfiction-profile.md) and apply its overrides.

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/outline-enhancer/SKILL.md](../../../skills/outline-enhancer/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Stage 0 of the generation half. Takes a premise/outline/beat sheet, deepens it into `outline/enriched-outline.md`, and seeds/augments `world/` (characters, threads, arcs with stable IDs). Marks unresolved questions campaign-pending rather than inventing answers. If `world/` was pre-seeded by `/world-notes-seeder`, it reads that first and augments — never contradicts.
