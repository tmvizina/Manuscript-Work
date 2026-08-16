---
name: manuscript-editing-planner-v2-rag
description: RAG-aware variant of /manuscript-editing-planner-v2 — canon lookups via the Book Writer RAG endpoint
---

# manuscript-editing-planner-v2-rag

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills-rag/manuscript-editing-planner-v2-rag/SKILL.md](../../../skills-rag/manuscript-editing-planner-v2-rag/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Identical to `/manuscript-editing-planner-v2` (EP-NNN IDs, dependency graph, conflict detection, pass scoping) except world/canon lookups go through the Book Writer RAG endpoint (token savings). Manuscript prose being planned for edit is still read from the chapter files in full.
