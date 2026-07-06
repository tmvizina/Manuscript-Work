---
description: RAG-aware variant of /audiobook-text-prep-chunker — canon lookups via the Book Writer RAG endpoint
argument-hint: "[chapter files or book folder to chunk]"
---

Invoke the `audiobook-text-prep-chunker-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/audiobook-text-prep-chunker-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/audiobook-text-prep-chunker` except occasional canon checks (e.g., proper-noun spellings) go through the Book Writer RAG endpoint (token savings). Most runs won't need any canon lookup at all; chunking always operates on the real `.txt` source.

Request: $ARGUMENTS
