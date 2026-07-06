---
description: RAG-aware variant of /manuscript-writer — canon lookups via the Book Writer RAG endpoint
argument-hint: "[plan or review to execute, and scope]"
---

Invoke the `manuscript-writer-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/manuscript-writer-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/manuscript-writer` except world/canon lookups go through the Book Writer RAG endpoint (token savings). Manuscript prose under edit is still read from the chapter files in full.

Request: $ARGUMENTS
