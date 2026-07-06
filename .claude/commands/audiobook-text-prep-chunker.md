---
description: Chunk formatted manuscript .txt into TTS-ready segments (~1500–1800 chars, never splitting sentences) + chunk manifest
argument-hint: "[chapter files or book folder to chunk]"
---

Invoke the `audiobook-text-prep-chunker` skill via the Skill tool. If the skill is not installed on this machine, read `skills/audiobook-text-prep-chunker/SKILL.md` in this repo and follow its instructions directly.

The last step of writing and this repo's hand-off boundary: emits `chunks/chXX_NNNN.txt` plus `chunk_manifest.json` — the documented contract the audiobook repos consume. Text preparation only; no audio generation, no Whisper.

Request: $ARGUMENTS
