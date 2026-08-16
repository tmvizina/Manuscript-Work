---
name: book-reviewer
description: The lector (v1) — manuscript/chapter/continuity review with severity-labeled findings
---

# book-reviewer

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/book-reviewer/SKILL.md](../../../skills/book-reviewer/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Full manuscript review, chapter review, continuity review, motif/repetition audits, character-arc review, audiobook readiness, and revision comparison. For delta-reviews against prior reports, stable RV-NNN IDs, and sign-off mode, use `/book-reviewer-v2`.
