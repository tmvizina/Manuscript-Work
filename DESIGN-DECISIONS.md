# DESIGN DECISIONS — Book Writer repo

Persisted rationale. Not build steps. Update as the repo evolves.

## Why this repo exists
The POC mixed manuscript authoring, audio, and image work in one tree. This repo
isolates the **text** pipeline: prompt → reviewed/edited/written manuscript →
formatted book → chunked text + manifest.

## Why the chunker lives here (not in the audiobook repos)
`audiobook-text-prep-chunker` is the final step of writing: it turns finished
chapter `.txt` into `chunks/chXX_NNNN.txt` + `chunk_manifest.json`. That pair is
the contract handed to the Local Audiobook Generator and the Cloud Audiobook
Repairer. Keeping the chunker here makes this repo's output self-contained and gives
the audio repos a stable, documented input format.

## v1 + v2 skills both included
v2 skills (reviewer/planner/writer) add stable IDs, voice gates, dependency graphs.
v1 are still valid for one-off use. Both are copied so the repo is complete; the
README points users at v2 by default.

## Naming conventions observed (kept as-is)
- Chapters: `Chapter NN - Title.txt` (NN can be fractional: `00.5`, `07.6`).
- Chunks: `chXX_NNNN.txt` where `chXX` is the manifest `source_file_id`.
- Manifest: `chunk_manifest.json` (machine) + `chunk_manifest.pretty.json` (human).
- Chunk target size: 1500–1800 chars, hard max 2000, never splitting sentences.

## Deliberately left out
- Audio (Speechify/stitch/repair) → Local Audiobook Generator repo.
- Cloud audit → Cloud Audiobook Repairer repo.
- All image prompt / generation work → the three image repos.
- World canon (`world/`), Dossi journals, reviews/editing-plan archives: NOT copied
  in bulk; only one optional sample of a review + plan is included to show the loop.

## Sample-vs-bulk policy
Only ONE example of each format is copied. The real manuscript, full chunk sets, and
full manifests stay in the POC. Samples exist to teach the format, not to migrate data.

**Polish (2026-06-20):** the manifest sample was trimmed from the full book
(51 source_files / 912 chunks, ~3.9 MB) to the first 2 chapters (`ch00`, `ch00_5`;
41 chunks, ~175 KB) with a `_sample_note` field. Same schema, far smaller repo. The
PLAN originally said "leave the manifest as-is"; this trim supersedes that so the
repo isn't dominated by one 4 MB file.

## Front of the pipeline (2026-06-20) — idea → writer-ready plan
The original repo started from a *writing prompt* and assumed the prose already existed
(review → plan → write → format → chunk). Added a **front of the pipeline** — three skills
that turn a human's raw idea into a writer-ready plan *before* that loop. Full design in
`FRONT-OF-PIPELINE.md`.

- **`outline-enhancer`** (the dramaturg) — deepens the human sketch and **seeds `world/`**
  (characters `CHAR-NNN`, threads `THR-NNN`, arcs `ARC-NNN`), marking unresolved directions
  campaign-pending rather than inventing them. It is the *first writer into `world/`*.
- **`story-arc-reviewer`** (the arc gate) — a **deliberate human checkpoint**. Surfaces the
  enhancer's arcs as questions (`AQ-NNN`) and records the author's answers (`AC-NNN`).
  Resolves campaign-pending items only when the author decides. This is the design choice
  that matters: the bot does not assume; it verifies arc direction with the author.
- **`manuscript-planner`** (the generation planner) — converts the validated outline into a
  **generation guide** (`GP-NNN`): chapter targets, scene briefs, thread beats, voice/
  continuity anchors. Deliberately *distinct from* `manuscript-editing-planner` (which plans
  revisions from reviewer findings); this one plans the first generation of new prose.

Why this shape:
- **Human checkpoints, not autonomy.** The arc gate mirrors the campaign-pending discipline
  already baked into the back half — some decisions are the author's to make. Surfacing
  beats inventing.
- **One shared memory.** The front *writes* `world/`; the existing v2 skills already *read*
  it as canon. The front simply fills, at genesis, the memory the back half expects.
- **Design + scaffolding only.** Complete `SKILL.md` + templates, no runner and no scripts
  yet. Each stage's hand-off contract is defined; wiring to execution is future work.

## Open questions
- Should `world/` canon travel with this repo (the manuscript skills reference it for
  continuity)? PARTIALLY RESOLVED (2026-06-20): the front-of-pipeline skills are the ones
  that *create* `world/`, so its directory shape is now documented (see
  `FRONT-OF-PIPELINE.md`). Still NO bulk canon data copied into the repo — only structure.
- Should the front-of-pipeline skills get a v2 (stable-ID/voice-gate parity with the back
  half), or stay single-version? For now single-version; revisit once they have a runner.
- Book 2 / prequel currently chunk into separate manifests; this repo is book-agnostic
  and samples are drawn from Book 1 only.
