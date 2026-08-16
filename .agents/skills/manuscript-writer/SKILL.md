---
name: manuscript-writer
description: The writer — triage an editorial plan per finding (Implement / Push back / Suggest-only) and apply accepted edits
---

# manuscript-writer

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/manuscript-writer/SKILL.md](../../../skills/manuscript-writer/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Takes an editorial plan (from `/book-reviewer` or hand-written) and decides per finding: Implement, Push back, or Suggest-only, with reasoning for every decision. Never broadly rewrites — suggested rewrites go to a sidecar for human approval. For cumulative voice-fingerprint state across passes, use `/manuscript-writer-v2`.
