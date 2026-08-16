---
name: manuscript-editing-planner-v2
description: Enhanced editing planner — EP-NNN plan IDs, dependency graph, conflict detection, risk register, pass scoping
---

# manuscript-editing-planner-v2

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/manuscript-editing-planner-v2/SKILL.md](../../../skills/manuscript-editing-planner-v2/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Use after the lector (`/book-reviewer-v2`) has produced findings, especially when the pass spans multiple chapters, findings touch the same passages, or `world/` files must update alongside prose changes.
