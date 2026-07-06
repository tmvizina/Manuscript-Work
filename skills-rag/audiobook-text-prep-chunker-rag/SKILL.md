---
name: audiobook-text-prep-chunker-rag
description: RAG-aware variant of audiobook-text-prep-chunker. Chunks manuscript .txt into Speechify-ready TTS segments (~1500-1800 chars, never splitting sentences) and produces a chunk manifest with placeholders for downstream generation, Whisper validation, and repair tracking — text preparation only, no audio. World/canon lookups go through the Book Writer RAG endpoint to save tokens; behavior is otherwise identical to audiobook-text-prep-chunker.
---

# audiobook-text-prep-chunker-rag

## What this is

A thin RAG-aware wrapper around `skills/audiobook-text-prep-chunker`. Behavior, inputs, outputs, and guarantees are identical to the base skill; the only change is that canon/world lookups (who/what/when facts from `world/` memory) are answered by querying the Book Writer RAG endpoint instead of reading whole `world/` files.

This skill rarely needs canon: RAG queries are only for occasional canon checks (e.g., verifying a proper-noun spelling against `world/` canon before it is baked into chunks) — most runs won't need any.

## How to run

1. Read `skills-rag/_shared/canon-lookup-protocol.md` for the full Canon Lookup Protocol.
2. Read `skills/audiobook-text-prep-chunker/SKILL.md` (the base skill) and follow it IN FULL.
3. Apply ONE override: wherever the base skill has you read files under `world/` for lookup purposes (characters, threads, arcs, voice bible, continuity ledger, locations, factions, timeline), use the Canon Lookup Protocol instead — one focused question per fact, related facts batched into a single query.

## Canon Lookup Protocol (summary)

Primary (Book Writer app):

    curl -s -X POST "${RAG_QUERY_URL:-http://localhost:8321/api/rag/query}" \
      -H 'content-type: application/json' -H 'X-RAG-Source: skill' \
      -d '{"q":"<specific question>","k":5}'

Response: `{ok, results: [{source, book, title, heading, text, score, tokens}], total_tokens}` — cite `source` as the `world/` file path.

Fallbacks, in order:
- **A** — rag service up: `curl -s "http://localhost:8323/query?q=<urlencoded>&k=5"` (docker) or the same on port `8801` (local `rag serve.py`).
- **B** — no HTTP services: `cd rag && .venv/bin/python query.py "<question>" -k 5 --json` (requires a local index).
- **C** — nothing works: read the targeted `world/` file directly. NEVER silently skip a canon check because the RAG was unavailable.

## Boundaries

- **Lookup only.** Manuscript prose being reviewed/edited/formatted MUST be read from the actual chapter `.txt` files — never review, edit, or quote-check prose from retrieved chunks. Chunking in particular MUST operate on the real `.txt` source, never on retrieved text.
- **Snapshot staleness.** The index does not auto-update; facts about content created or edited in the CURRENT session are suspect — verify against the real files. After canon writes, remind the user to rebuild the index (Help → Maintaining & Embedding the RAG, or `POST /api/rag/ingest`).
- **Cite sources.** When a retrieved chunk justifies a finding or decision, cite its `source` metadata (file path + heading).
- **Low scores are not absence.** If retrieval returns nothing relevant, fall back to reading the targeted `world/` file — absence of retrieval results is NOT evidence the fact doesn't exist.
