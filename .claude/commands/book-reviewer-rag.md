---
description: RAG-aware variant of /book-reviewer — canon lookups via the Book Writer RAG endpoint
argument-hint: "[review target and scope, e.g. 'chapters 1–5, pacing focus']"
---

Invoke the `book-reviewer-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/book-reviewer-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/book-reviewer` except world/canon lookups go through the Book Writer RAG endpoint (token savings). Manuscript prose under review is still read from the chapter files in full.

Request: $ARGUMENTS
