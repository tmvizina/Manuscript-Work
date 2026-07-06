---
description: RAG-aware variant of /world-notes-seeder — canon lookups via the Book Writer RAG endpoint
argument-hint: "[path(s) to note files or folder, e.g. ~/Downloads/world-notes/]"
---

Invoke the `world-notes-seeder-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/world-notes-seeder-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/world-notes-seeder` except reconciliation lookups against existing canon go through the Book Writer RAG endpoint (token savings). All canon WRITES still go to the real `world/` files, and the run ends with a reminder to rebuild the RAG index.

Request: $ARGUMENTS
