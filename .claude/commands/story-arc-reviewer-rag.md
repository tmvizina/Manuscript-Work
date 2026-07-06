---
description: RAG-aware variant of /story-arc-reviewer — canon lookups via the Book Writer RAG endpoint
argument-hint: "[enriched outline to gate, or answers to record]"
---

Invoke the `story-arc-reviewer-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/story-arc-reviewer-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/story-arc-reviewer` — same human-in-the-loop arc gate — except world/canon lookups go through the Book Writer RAG endpoint (token savings).

Request: $ARGUMENTS
