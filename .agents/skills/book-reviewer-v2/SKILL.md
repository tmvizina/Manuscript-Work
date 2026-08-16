---
name: book-reviewer-v2
description: Review fiction or nonfiction manuscripts with stable RV-NNN findings, project memory, voice protection, delta review, and sign-off modes
---

# book-reviewer-v2

When `.book-writer/project.json` selects nonfiction, also read [skills/nonfiction-profile.md](../../../skills/nonfiction-profile.md) and apply its overrides.

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/book-reviewer-v2/SKILL.md](../../../skills/book-reviewer-v2/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Use v2 when:
- Prior reviews exist that should not be re-flagged.
- A writer pass needs verification or sign-off.
- `world/` memory should be consulted before claiming continuity errors.
- You want findings emitted with stable RV-NNN IDs for the planner and writer.
