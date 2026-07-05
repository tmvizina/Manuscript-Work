---
name: manuscript-rag
description: Builds and queries a local ChromaDB vector index of a manuscript so reviews retrieve only the passages relevant to a query instead of loading whole chapters into context. Use this skill to cut review query costs — index the chapters once (local ONNX embeddings, no API cost), then run a targeted retrieval per concern (a motif, a character, a continuity fact, a name) and feed only the top-k cited passages to the reviewer. Mentions "RAG", "retrieval", "vector index", "embed the manuscript", "reduce review cost", "chroma", or "why is the review reading the whole book". Text-prep + retrieval only — it does not write reviews or edit prose.
when_to_use: Use when a manuscript is large enough that loading whole chapters into the reviewer is expensive or does not fit the context budget, when a review is targeted (continuity of one fact, one character's arc, a motif audit, audiobook name/pronunciation consistency) and only a fraction of the book is relevant, or when you want the book-reviewer to cite specific passages by chapter and line without re-reading everything. Build/refresh the index with rag_index.py; retrieve with rag_query.py. For a one-off review of a single short chapter that already fits in context, RAG is unnecessary.
argument-hint: "[build the index | query text | chapter scope]"
---

# manuscript-rag

This skill makes reviews cheap. Instead of loading 35 chapters (~290k words) into
the review model on every pass, it:

1. **Indexes the manuscript once** — splits chapters into sentence-aware passages
   and embeds them **locally** (ChromaDB's bundled ONNX MiniLM — no API key, no
   per-query cost) into a persistent vector store.
2. **Retrieves per concern** — for each review query (a motif, a character, a
   continuity fact, a proper noun) it returns only the top-k most relevant
   passages, each with a citation (`source_file_id`, chapter, line range).

Only those retrieved passages are sent to the expensive review model. A
continuity check that used to require reading the whole book now reads ~10–20
passages. That is the cost win.

```
[this skill]                              [the reviewer, cheaper]
rag_index.py  → local vector store  → rag_query.py → top-k cited passages → book-reviewer-v2
(embed once, free)                     (retrieve, free)                      (reason over a fraction of the book)
```

## When to invoke

Invoke when the user wants to:

- Build or refresh a searchable index of a manuscript ("embed the book", "index
  the chapters", "set up RAG for reviews").
- Retrieve the passages relevant to a specific review question without loading
  whole chapters.
- Cut the token cost / context pressure of a targeted review (continuity of one
  fact, one character's arc, a motif audit, audiobook name consistency).

Do **not** invoke for:

- Writing the review itself (that is `book-reviewer` / `book-reviewer-v2`).
- Editing prose (that is `manuscript-writer`).
- Chunking for audio (that is `audiobook-text-prep-chunker` — a *different* kind
  of chunk; see "Relationship to the audiobook chunker" below).

## Install

```bash
pip install -r skills/manuscript-rag/requirements.txt   # just chromadb
```

The default `local` embedder downloads a ~80 MB ONNX model once on first use,
then runs on CPU offline. No API key. (See "Embedders" for the offline-test and
OpenAI alternatives.)

## How to run

The scripts live in `scripts/` and import a shared `rag_common.py`, so run them
from that directory (or add it to `PYTHONPATH`).

### 1. Build the index (once, then refresh after edits)

```bash
cd skills/manuscript-rag/scripts

# Index a directory of chapter .txt files. Writes the store to <chapters>/.rag-index
python rag_index.py --source /path/to/manuscript/chapters/

# Re-run any time — INCREMENTAL by default: a chapter whose text is unchanged
# is skipped; only edited chapters are re-embedded.
python rag_index.py --source /path/to/manuscript/chapters/

# Confine a refresh to specific chapters
python rag_index.py --source /path/to/manuscript/chapters/ --only ch07,ch08

# Preview what would change without writing
python rag_index.py --source /path/to/manuscript/chapters/ --dry-run
```

Incremental behavior mirrors the audiobook chunker's philosophy: each chapter is
fingerprinted (`source_hash`); unchanged chapters are left untouched, changed
chapters have their old passages deleted and re-embedded.

### 2. Query for a review (the cost-saving step)

```bash
cd skills/manuscript-rag/scripts

# Continuity check — retrieve only passages about a specific fact
python rag_query.py --db /path/to/manuscript/chapters/.rag-index \
    --query "Charlie's two marks — Asmodean black and Bahamut silver" --k 8

# Scope to a chapter (or a few)
python rag_query.py --db .../.rag-index --query "Dossi's mentor cadence" --scope ch07

# Machine-readable, for the reviewer to consume programmatically
python rag_query.py --db .../.rag-index --query "the Shield of the Hidden Lord" --k 12 --json
```

Each result carries a citation the reviewer quotes and anchors:

```
## [1] ch02 · Chapter 02 - The Ledger of Ash (lines 1–5) · distance=0.77
Dossi counted the exits before she counted the men. ...
```

## Embedders

| `--embedder` | Cost | Quality | Use when |
|---|---|---|---|
| `local` (default) | **free** — local ONNX MiniLM, no API | good | almost always — this is the cost win |
| `openai` | cheap per-token API (needs `OPENAI_API_KEY`) | higher | large corpora where retrieval quality matters most |
| `hash` | free, offline, no deps beyond stdlib | low (lexical only) | CI / smoke tests / no network |

The embedder and model are recorded in the index's `rag_config.json`. `rag_query.py`
defaults to whatever the index was built with; changing the embedder requires a
full rebuild (`--full`), because vectors from different models are not comparable.

## How the reviewer uses this (retrieval-augmented review)

For a **targeted** review (continuity of a fact, one character's arc, a motif
audit, audiobook name consistency), the reviewer should, instead of reading whole
chapters:

1. Turn each concern into one or more retrieval queries (the motif word, the
   character name + trait, the continuity fact, the proper noun).
2. Run `rag_query.py` for each, `--k 8`–`12`, `--json`.
3. Reason **only over the retrieved passages**, citing their `source_file_id`
   and line range in the `RV-…` finding's Location/Evidence fields.
4. Escalate to a full chapter read only for the handful of chapters whose
   retrieved passages raise a flag — the same "sample, then deep-read" discipline
   the reviewer already documents under *Length-Safety Guidance*, now driven by
   retrieval instead of manual scanning.

`book-reviewer-v2` documents this under **Retrieval-Augmented Review (RAG)**.
Manuscript-wide *structural* reads (overall arc, book-level pacing) still benefit
from broad reading and are not a good fit for retrieval; RAG shines on the
targeted modes (D continuity, E character arc, F motif, G audiobook).

## Relationship to the audiobook chunker

Both tools "chunk" the manuscript, but for opposite consumers and they are **not**
interchangeable:

- `audiobook-text-prep-chunker` produces **Speechify** chunks: markdown stripped,
  pronunciation respellings applied ("Dossi" → "DAH-si"), sized for the TTS API.
  That text is wrong for retrieval — you would embed and cite mangled prose.
- `manuscript-rag` indexes the **original prose** (light normalization only) so
  retrieved passages read and cite exactly as the author wrote them.

So RAG builds its own passages from the raw chapters rather than reusing the audio
chunk manifest.

## Outputs

```
<chapters>/.rag-index/          # ChromaDB persistent store (git-ignore this)
  chroma.sqlite3                #   the vector store
  rag_config.json               #   embedder + model + splitter settings (for query-time match)
```

`rag_index.py --report path.json` also writes a per-chapter run report
(new / reindexed / unchanged, passage counts).

## Important non-actions

- Does **not** write reviews or make findings (that is the reviewer).
- Does **not** edit or move the source `.txt` manuscripts (read-only on them).
- Does **not** call any paid API on the default `local` embedder.
- Stores vectors under `--db` (default `<source>/.rag-index`); add that path to
  `.gitignore` — it is a rebuildable cache, not canon.
