# Canon RAG — ChromaDB index + query page

Semantic index over the shared canon (`world/`) and all manuscript chapters (Book 1, Book 2, prequel), with a side-by-side demo page comparing RAG retrieval against a naive keyword pull — token cost shown next to every answer.

## Layout

- `raglib.py` — corpus discovery + chunking (~1200 chars, 1-paragraph overlap; markdown splits on headings) + Chroma client config. Collection `dragonwings_canon`, cosine space, local ONNX MiniLM embeddings (no API key).
- `ingest.py` — build the index: `.venv/bin/python ingest.py --rebuild`
- `query.py` — standalone query CLI: `.venv/bin/python query.py "who is Maereth" -k 5 [--json|--stats]`
- `rag_worker.py` — persistent stdin/stdout JSON-lines worker the server keeps warm.
- `server/` — dependency-light Node server (`npm start`, port 3123 or `PORT=`):
  - `POST /api/query {q,k}` runs **two parallel workers** — the Chroma RAG worker and `naive-worker.js` (worker thread: word-boundary grep, ranks files, pulls whole files as context).
  - Token counts via `gpt-tokenizer` (cl100k_base); falls back to chars/4 if not installed.
  - `public/index.html` — the query page.

## Setup from scratch

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python ingest.py --rebuild
cd server && npm install && npm start
```

Re-run `ingest.py --rebuild` after canon/chapter edits; the index does not auto-update.

`chroma_db/`, `.venv/`, `server/node_modules/` are gitignored.

**Pointing at your manuscript repo:** the corpus roots (`world/`, `chapters/`, `book-2/chapters/`, `prequel-novella/chapters/`) resolve relative to `RAG_REPO_ROOT` if set, otherwise this repo's root. When running from a repo that doesn't hold the manuscript (like this one), export it first:

```sh
export RAG_REPO_ROOT=~/RiderProjects/RoadBeneathDragonsWings
.venv/bin/python ingest.py --rebuild
```
