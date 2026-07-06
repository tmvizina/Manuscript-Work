---
description: RAG-aware variant of /novel-formatting — canon lookups via the Book Writer RAG endpoint
argument-hint: "[files or folder to format, and target format]"
---

Invoke the `novel-formatting-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/novel-formatting-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/novel-formatting` except occasional canon checks (e.g., proper-noun spellings) go through the Book Writer RAG endpoint (token savings). Most runs won't need any canon lookup at all; prose being formatted is always read from the real files.

Request: $ARGUMENTS
