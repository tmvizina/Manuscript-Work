---
description: RAG-aware variant of /manuscript-planner — canon lookups via the Book Writer RAG endpoint
argument-hint: "[validated outline to plan from, and scope]"
---

Invoke the `manuscript-planner-rag` skill via the Skill tool. If the skill is not installed on this machine, read `skills-rag/manuscript-planner-rag/SKILL.md` in this repo and follow its instructions directly.

Identical to `/manuscript-planner` except world/canon lookups (threads, arcs, characters, voice anchors) go through the Book Writer RAG endpoint (token savings).

Request: $ARGUMENTS
