---
name: story-arc-reviewer
description: Run the human checkpoint for fictional arcs or nonfiction structure, audience, coverage, omissions, and unresolved author decisions
---

# story-arc-reviewer

When `.book-writer/project.json` selects nonfiction, also read [skills/nonfiction-profile.md](../../../skills/nonfiction-profile.md) and apply its overrides.

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/story-arc-reviewer/SKILL.md](../../../skills/story-arc-reviewer/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

Stage 0.5 of the generation half. Reviews the outline-enhancer's proposed arcs, asks the author the questions needed to confirm arc direction, records answers as canon in `world/`, and hands down `outline/validated-outline.md`. Not an autonomous approver — the author decides.
