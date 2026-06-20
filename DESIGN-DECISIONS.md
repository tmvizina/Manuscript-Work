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

## Open questions
- Should `world/` canon travel with this repo (the manuscript skills reference it for
  continuity)? For now NO — left in POC. Revisit if the writer skills need it at runtime.
- Book 2 / prequel currently chunk into separate manifests; this repo is book-agnostic
  and samples are drawn from Book 1 only.
