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

## RAG index for reviews (`manuscript-rag`) — why, and the choices made
The review skills read chapters into context to reason about them. At ~290k
words the reviewer's own *Length-Safety Guidance* admits a full read "will not
fit in any practical context budget," forcing manual scoping. `manuscript-rag`
attacks that cost directly: index the chapters once into a local ChromaDB vector
store, then for a **targeted** review retrieve only the top-k relevant passages
(cited by chapter + line) and send *those* to the review model instead of whole
chapters.

Choices:
- **Local embeddings by default.** The default `local` embedder is ChromaDB's
  bundled ONNX MiniLM: runs on CPU, no API key, **no per-query cost**. That is
  the cost win — retrieval is free; only the retrieved passages hit the paid
  review model. `openai` (cheap API) and `hash` (offline, deterministic, low
  quality — for CI/smoke tests) are alternatives. Embedder+model are recorded in
  `rag_config.json`; switching them requires `--full` (vectors aren't comparable).
- **Index raw prose, not the audiobook chunks.** The audiobook chunker strips
  Markdown and applies pronunciation respellings ("Dossi" → "DAH-si"); that text
  is wrong to embed or cite. RAG builds its own sentence-aware passages (with
  overlap, char/line offsets) from the original chapters so citations read as the
  author wrote them. The two "chunkers" serve opposite consumers and are not
  interchangeable.
- **Incremental by source hash**, mirroring the chunker: unchanged chapters are
  skipped, edited chapters re-embedded. `--only`, `--dry-run`, `--full` included.
- **Additive, not invasive.** New skill + a *Retrieval-Augmented Review* section
  in `book-reviewer-v2`. The full-read path stays as the documented fallback, and
  Mode A (structural, book-level) reviews still read broadly — RAG is for the
  targeted modes (continuity, character arc, motif, audiobook).
- **New third-party dependency.** `chromadb` is the repo's first non-stdlib
  runtime dep (the chunker is stdlib-only). It is isolated to this one skill,
  pinned in `skills/manuscript-rag/requirements.txt`, and the scripts fail with a
  clear install hint if it's absent. The `.rag-index/` store is a rebuildable
  cache — git-ignore it, don't commit it.

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
