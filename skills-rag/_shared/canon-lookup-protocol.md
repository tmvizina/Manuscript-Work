# Canon Lookup Protocol

The authoritative protocol for how `skills-rag/` variant skills perform world/canon lookups. Every `<name>-rag` skill delegates to its base skill in `skills/<name>/` and applies exactly one override: canon lookups go through the RAG described here instead of reading whole `world/` files.

## Purpose

Canon/world lookups — who/what/when facts drawn from `world/` memory (characters, threads, arcs, voice bible, continuity ledger, locations, factions, timeline) — should be answered by querying the Book Writer RAG instead of opening entire `world/` files. Retrieval returns only the relevant chunks, saving tokens on every lookup.

Query discipline:
- Ask ONE focused question per fact ("What color is Maereth's dragon form?", "Is THR-014 harvested before Chapter 30?").
- Batch related facts into a SINGLE query when they share a subject ("Charlie's infernal parentage: father, true name, when revealed").
- Do not paste manuscript prose into queries; ask about the fact, not the passage.

## Primary endpoint (the Book Writer app)

```bash
curl -s -X POST "${RAG_QUERY_URL:-http://localhost:8321/api/rag/query}" \
  -H 'content-type: application/json' \
  -H 'X-RAG-Source: skill' \
  -d '{"q":"<specific question>","k":5}'
```

Response JSON:

```json
{
  "ok": true,
  "results": [
    {"source": "world/characters.md", "book": "…", "title": "…", "heading": "…", "text": "…", "score": 0.87, "tokens": 142}
  ],
  "total_tokens": 640
}
```

Treat `source` as the `world/` file path to cite.

## Fallback chain

Try these in order. Move down the chain only when the level above fails (connection refused, non-JSON response, `ok: false`).

**Fallback A — app down, rag service up.** Query the standalone rag service directly:

```bash
# docker rag service
curl -s "http://localhost:8323/query?q=<urlencoded question>&k=5"
# or, if rag serve.py is running locally
curl -s "http://localhost:8801/query?q=<urlencoded question>&k=5"
```

**Fallback B — no HTTP services.** Query the index offline from the repo root:

```bash
cd rag && .venv/bin/python query.py "<question>" -k 5 --json
```

Requires a local index to have been built.

**Fallback C — nothing works.** Read the targeted `world/` file directly, exactly as the base skill would have. NEVER silently skip a canon check because the RAG was unavailable — degrade to direct file reads instead.

## Boundaries (critical)

1. **RAG is for LOOKUP only.** Manuscript prose being reviewed, edited, or formatted MUST still be read from the actual chapter `.txt` files. Never review, edit, or quote-check prose from retrieved chunks — chunks are evidence for facts, not a substitute for the text being worked on.

2. **The index is a snapshot.** It does not auto-update. Facts about content created or edited in the CURRENT session are suspect — verify those against the real files. After any canon writes to `world/`, remind the user to rebuild the index (Help → Maintaining & Embedding the RAG in the Book Writer app, or `POST /api/rag/ingest`).

3. **Cite your sources.** When a retrieved chunk justifies a finding or decision, cite its `source` metadata (file path + heading) so the human can verify the canon claim.

4. **Absence of results is not absence of fact.** If retrieval returns nothing relevant (low scores), fall back to reading the targeted `world/` file — the fact may exist in a form the embedding missed, be phrased differently, or live in a file the index skipped.
