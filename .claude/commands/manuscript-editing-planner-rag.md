---
description: RAG-aware variant of /manuscript-editing-planner — canon lookups via the Book Writer RAG endpoint
argument-hint: "[review report to plan from]"
---

Invoke the `manuscript-editing-planner-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/manuscript-editing-planner-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/manuscript-editing-planner` except world/canon lookups go through the Book Writer RAG endpoint (token savings). Manuscript prose being planned for edit is still read from the chapter files in full.

Request: $ARGUMENTS
