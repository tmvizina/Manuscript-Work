---
name: manuscript-writer-v2
description: Enhanced writer — voice fingerprint, precedent ledger, proactive findings, self-diff voice gate before commit
---

# manuscript-writer-v2

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/manuscript-writer-v2/SKILL.md](../../../skills/manuscript-writer-v2/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Use v2 when the manuscript has a voice signature to defend explicitly, prior passes have re-argued the same points, or you want accepted edits voice-audited cold before commit. For simple one-off triage, `/manuscript-writer` (v1) is enough.
