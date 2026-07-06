---
description: RAG-aware variant of /chapter-title-cleanup — canon lookups via the Book Writer RAG endpoint
argument-hint: "[scope — e.g. 'audit all Book 1 titles' or 'renumber after the Ch 12 insert']"
---

Invoke the `chapter-title-cleanup-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/chapter-title-cleanup-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/chapter-title-cleanup` except occasional canon checks (e.g., proper-noun spellings in titles) go through the Book Writer RAG endpoint (token savings). Most runs won't need any canon lookup at all.

Request: $ARGUMENTS
