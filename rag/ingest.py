#!/usr/bin/env python
"""Build (or rebuild) the Chroma collection from world/ canon + all chapter files.

Usage:
    .venv/bin/python ingest.py --rebuild
"""
import argparse
import sys
import time

import raglib


def run_ingest(rebuild: bool = False, batch: int = 64, quiet: bool = False) -> dict:
    """Ingest the corpus; returns {files, chunks, seconds, count}. Importable (serve.py's POST /ingest)."""
    t0 = time.time()
    client = raglib.get_client()
    if rebuild:
        try:
            client.delete_collection(raglib.COLLECTION)
        except Exception:
            pass
    col = raglib.get_collection(client, create=True)

    n_files = 0
    n_chunks = 0
    ids, docs, metas = [], [], []

    def flush():
        nonlocal ids, docs, metas
        if ids:
            col.upsert(ids=ids, documents=docs, metadatas=metas)
            ids, docs, metas = [], [], []

    for book, path in raglib.corpus_files():
        chunks = raglib.chunk_file(book, path)
        n_files += 1
        n_chunks += len(chunks)
        for c in chunks:
            ids.append(c["id"])
            docs.append(c["text"])
            metas.append(c["metadata"])
            if len(ids) >= batch:
                flush()
        if not quiet:
            print(f"  [{book}] {path.name}: {len(chunks)} chunks", file=sys.stderr)
    flush()

    return {
        "files": n_files,
        "chunks": n_chunks,
        "seconds": round(time.time() - t0, 1),
        "count": col.count(),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rebuild", action="store_true", help="drop and re-create the collection first")
    ap.add_argument("--batch", type=int, default=64, help="upsert batch size")
    args = ap.parse_args()

    r = run_ingest(rebuild=args.rebuild, batch=args.batch)
    print(
        f"Ingested {r['chunks']} chunks from {r['files']} files in {r['seconds']}s "
        f"-> {raglib.DB_DIR} (collection '{raglib.COLLECTION}', count={r['count']})"
    )


if __name__ == "__main__":
    main()
