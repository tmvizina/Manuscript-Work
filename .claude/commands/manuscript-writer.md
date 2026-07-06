---
description: The writer — triage an editorial plan per finding (Implement / Push back / Suggest-only) and apply accepted edits
argument-hint: "[plan or review to execute, and scope]"
---

Invoke the `manuscript-writer` skill via the Skill tool. If the skill is not installed on this machine, read `skills/manuscript-writer/SKILL.md` in this repo and follow its instructions directly.

Takes an editorial plan (from `/book-reviewer` or hand-written) and decides per finding: Implement, Push back, or Suggest-only, with reasoning for every decision. Never broadly rewrites — suggested rewrites go to a sidecar for human approval. For cumulative voice-fingerprint state across passes, use `/manuscript-writer-v2`.

Request: $ARGUMENTS
