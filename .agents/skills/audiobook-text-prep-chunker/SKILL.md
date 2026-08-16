---
name: audiobook-text-prep-chunker
description: Chunk formatted manuscript .txt into TTS-ready segments (~1500–1800 chars, never splitting sentences) + chunk manifest
---

# audiobook-text-prep-chunker

Use the repository's canonical workflow rather than duplicating it here:

1. Read [skills/audiobook-text-prep-chunker/SKILL.md](../../../skills/audiobook-text-prep-chunker/SKILL.md) completely, including any references it explicitly requires for the current task.
2. Follow that workflow in full. Treat the user's current request as the value represented by `${ARGUMENTS}` in legacy skill text.
3. Resolve all relative paths in the canonical workflow from the canonical skill directory, not from this adapter directory.
4. Ignore legacy Claude-only metadata fields such as `when_to_use` and `argument-hint`; the `description` above controls Codex discovery.
5. Use Codex's available tools directly. Do not look for or invoke a Claude `Skill` tool.

## Invocation guidance

The last step of writing and this repo's hand-off boundary: emits `chunks/chXX_NNNN.txt` plus `chunk_manifest.json` — the documented contract the audiobook repos consume. Text preparation only; no audio generation, no Whisper.
