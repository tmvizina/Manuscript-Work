---
name: chapter-title-cleanup
description: Clean up, audit, renumber, and standardize chapter/part/section titles and filenames without rewriting prose
---

# chapter-title-cleanup

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/chapter-title-cleanup/SKILL.md](../../../skills/chapter-title-cleanup/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Title and numbering work only — audits consistency, fixes numbering cascades, compares title lists, produces title maps. Never touches prose.
