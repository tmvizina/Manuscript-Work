# Manuscript Work — Codex Instructions

## Repository purpose

This repository contains the text-authoring half of a fantasy-novel production pipeline. Keep audio generation, cloud audio repair, and image generation out of scope. The workflow runs from world-note intake and outline development through drafting, review, revision, formatting, and TTS chunk preparation.

## Codex skills

- Repository skills are discoverable under `.agents/skills/` and can be invoked as `$skill-name`.
- The detailed, canonical workflow text remains under `skills/` and `skills-rag/`. The `.agents/skills/` files are Codex adapters; do not duplicate the canonical workflow into them.
- When changing a workflow, edit its canonical `skills/<name>/SKILL.md` or `skills-rag/<name>/SKILL.md` file first. Update the matching adapter only when its discovery description or Codex-specific routing changes.
- Prefer v2 for substantive review, editing-plan, and writer passes. Keep v1 available for small one-off work.
- Use a `-rag` skill only when the Book Writer RAG service is available and the task benefits from canon lookup. RAG may answer focused canon questions, but it must never replace reading the actual manuscript passages being reviewed, planned, edited, formatted, or chunked.

## Editorial boundaries

- Treat `world/` in the target manuscript repository as canon. Do not invent resolutions for unknown or campaign-pending facts.
- Preserve the author's voice. Separate correctness and continuity fixes from optional stylistic suggestions.
- Respect the human checkpoint in `story-arc-reviewer`: surface questions and wait for the author's decisions before recording unresolved directions as canon.
- Do not broaden revision scope silently. Follow the requested book, chapter range, pass type, and output location.
- Never overwrite contradictions in canon without surfacing them. Record conflicts and open questions for author review.

## Repository maintenance

- Preserve stable IDs such as `CHAR-NNN`, `THR-NNN`, `ARC-NNN`, `OB-NNN`, `AQ-NNN`, `GP-NNN`, `RV-NNN`, and `EP-NNN`; never renumber existing entities casually.
- Keep `SKILL.md` frontmatter concise and make descriptions specific enough for reliable implicit triggering.
- Resolve paths relative to the canonical skill folder when a skill loads templates, references, examples, or scripts.
- After changing the audiobook chunker, run its focused tests or a dry run against `samples/manuscript/` and verify sentence boundaries and the 2,000-character hard limit.
- Preserve `.claude/` as legacy Claude compatibility unless the user explicitly asks to remove it.
