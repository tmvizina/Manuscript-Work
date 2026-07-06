---
description: RAG-aware variant of /outline-enhancer — canon lookups via the Book Writer RAG endpoint
argument-hint: "[path to the human sketch, or the premise/beats inline]"
---

Invoke the `outline-enhancer-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/outline-enhancer-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/outline-enhancer` except reconciliation lookups against existing canon go through the Book Writer RAG endpoint (token savings). All canon WRITES still go to the real `world/` files, and the run ends with a reminder to rebuild the RAG index.

Request: $ARGUMENTS
