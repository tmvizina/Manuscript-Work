---
name: novel-formatting
description: Format fiction or nonfiction manuscript files consistently while preserving prose, procedures, lists, chapter order, and audiobook readability
---

# novel-formatting

When `.book-writer/project.json` selects nonfiction, also read [skills/nonfiction-profile.md](../../../skills/nonfiction-profile.md) and apply its overrides.

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/novel-formatting/SKILL.md](../../../skills/novel-formatting/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Produces clean, novel-ready Markdown or plain text while preserving prose, chapter order, scene breaks, and audiobook readability. The step before `/audiobook-text-prep-chunker`.
