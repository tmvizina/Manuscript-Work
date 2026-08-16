---
name: manuscript-editing-planner
description: Editing planner (v1) — convert a review report into a structured editing plan with per-chapter detail
---

# manuscript-editing-planner

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/manuscript-editing-planner/SKILL.md](../../../skills/manuscript-editing-planner/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Turns reviewer findings into a concrete editing plan — book-structure recommendations, chapter splits, title suggestions, per-chapter plans. For multi-chapter passes with dependencies, conflicts, and risk registers, use `/manuscript-editing-planner-v2`.
