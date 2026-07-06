# Maintaining & Embedding the RAG

The index is a **snapshot**: it only knows what the corpus looked like at the
last rebuild. Nothing updates it automatically.

## When to rebuild

Rebuild after anything that changes the corpus:

- new or edited chapters in `chapters/` (or `book-2/chapters/`,
  `prequel-novella/chapters/`)
- any change under `world/` (the seeder, enhancer, and arc gate all write
  there — their RAG-aware variants remind you at the end of a run)

A rebuild is cheap: it re-scans everything from scratch, so there's no harm in
doing it whenever you're unsure.

## How to rebuild

Pick whichever is closest to hand:

- **The RAG page** (top bar → RAG) → **Rebuild index** button. Shows files,
  chunks, and seconds when done.
- **The API:** `curl -X POST localhost:8321/api/rag/ingest` (or the rag
  service directly: `curl -X POST localhost:8323/ingest`).
- **Inside the container:** `docker compose exec rag python ingest.py --rebuild`
- **Locally, no docker:** from `rag/`, with a venv
  (`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`):

  ```sh
  .venv/bin/python ingest.py --rebuild
  ```

## What gets indexed

`world/**/*.md` plus `chapters/`, `book-2/chapters/`, and
`prequel-novella/chapters/` `*.txt`, all resolved under the **manuscript
root** — this repo by default. Missing folders are simply skipped (a brand-new
book starts at 0 chunks; that's normal). To index a different manuscript
checkout, set `MANUSCRIPT_DIR` in `.env` (absolute path) and
`docker compose up -d` again — the same root drives both the chapter viewer
and the RAG corpus.

## The two storage modes

- **Compose (normal):** the index lives in the `chromadb` service
  (`chroma-data` docker volume). The rag service reaches it because
  `CHROMA_HOST=chromadb` is set. Your repo stays clean.
- **Local fallback:** with no `CHROMA_HOST` set, the python tools write a
  private index into `rag/chroma_db/` (gitignored). Handy for `query.py`
  experiments without docker. The two stores are independent — rebuilding one
  does not touch the other.

## Version pinning (important)

The ChromaDB **client** (`rag/requirements.txt`: `chromadb==1.5.9`) and
**server image** (`docker-compose.yml`: `chromadb/chroma:1.5.9`) are pinned to
the same release on purpose — client and server speak a versioned API, and
mismatched pairs fail in confusing ways. Upgrade them **together**, then
rebuild the rag image (`docker compose build rag`) and reingest.

## Sanity checks

```sh
curl localhost:8321/api/rag/health        # {"ok":true,"chunks":N}
curl -X POST localhost:8321/api/rag/query \
  -H 'content-type: application/json' -d '{"q":"who is the protagonist","k":3}'
```

The RAG page's query log shows every lookup, including the ones RAG-aware
skills make (tagged `skill`) — useful for confirming the variants are actually
saving you tokens.
