---
description: RAG-aware variant of /book-reviewer-v2 — canon lookups via the Book Writer RAG endpoint
argument-hint: "[scope, sign-off pass, delta against prior review, etc.]"
---

Invoke the `book-reviewer-v2-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/book-reviewer-v2-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/book-reviewer-v2` (stable RV-NNN IDs, delta-review, sign-off) except world/canon lookups go through the Book Writer RAG endpoint (token savings). Manuscript prose under review is still read from the chapter files in full.

Request: $ARGUMENTS
