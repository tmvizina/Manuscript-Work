# manuscript-rag

A local ChromaDB vector index of the manuscript so **reviews retrieve only the
passages relevant to a query** instead of loading whole chapters into the review
model. The point is cost: embedding and retrieval run locally for free, and only
the top-k cited passages reach the expensive reviewer.

- **Full skill doc:** [`SKILL.md`](SKILL.md)
- **Dependencies:** [`requirements.txt`](requirements.txt) (`chromadb` only)

## TL;DR

```bash
pip install -r requirements.txt

cd scripts
# Build once (local ONNX embeddings — no API key, no per-query cost). Incremental on re-run.
python rag_index.py --source /path/to/manuscript/chapters/

# Retrieve the passages relevant to a review concern (cited by chapter + line range)
python rag_query.py --db /path/to/manuscript/chapters/.rag-index \
    --query "Charlie's two marks — Asmodean black and Bahamut silver" --k 8
```

## Files

```
manuscript-rag/
  SKILL.md            <- when/how to build the index and use retrieval in reviews
  requirements.txt    <- chromadb
  scripts/
    rag_common.py     <- splitter, embedder factory, ChromaDB helpers
    rag_index.py      <- build/update the index (incremental by source hash)
    rag_query.py      <- retrieve top-k cited passages (text or --json)
```

## Offline / CI

No network? Use `--embedder hash` (a deterministic, dependency-free lexical
embedder) to exercise the whole pipeline without downloading a model. Retrieval
quality is low — it is for smoke tests, not real reviews.

See `SKILL.md` → *Relationship to the audiobook chunker* for why this indexes raw
prose rather than reusing the audiobook chunk manifest.
