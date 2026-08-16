---
name: novel-formatting-rag
description: RAG-aware variant of /novel-formatting — canon lookups via the Book Writer RAG endpoint
---

# novel-formatting-rag

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills-rag/novel-formatting-rag/SKILL.md](../../../skills-rag/novel-formatting-rag/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Identical to `/novel-formatting` except occasional canon checks (e.g., proper-noun spellings) go through the Book Writer RAG endpoint (token savings). Most runs won't need any canon lookup at all; prose being formatted is always read from the real files.
