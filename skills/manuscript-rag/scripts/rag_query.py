#!/usr/bin/env python3
"""rag_query.py — retrieve the manuscript passages most relevant to a query.

This is the cost-saving half of the RAG tool. Instead of loading whole chapters
into the review model, the reviewer runs a query per concern (a motif, a
character, a continuity fact, a name that must be pronounced consistently) and
gets back only the top-k passages — each with a citation the reviewer can quote
and anchor.

    # Plain text output (what the reviewer reads)
    python rag_query.py --query "Charlie's two marks — Asmodean black and Bahamut silver" --k 8

    # Restrict to one chapter
    python rag_query.py --query "Dossi mentor cadence" --scope ch07

    # JSON for programmatic use
    python rag_query.py --query "the Shield of the Hidden Lord" --k 12 --json

The embedder must match the one the index was built with; rag_query reads the
index's rag_config.json and defaults to it, erroring on an explicit mismatch.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional, Sequence

import rag_common as rc

logger = rc.logger


def _load_config(db_path: Path) -> dict:
    cfg = db_path / "rag_config.json"
    if not cfg.is_file():
        raise SystemExit(
            f"No rag_config.json in {db_path}. Build the index first with "
            f"rag_index.py (or point --db at the right directory)."
        )
    return json.loads(cfg.read_text(encoding="utf-8"))


def _shorten(text: str, max_chars: int) -> str:
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def run_query(args: argparse.Namespace) -> int:
    db_path: Path = args.db
    cfg = _load_config(db_path)

    embedder = args.embedder or cfg.get("embedder", "local")
    embed_model = args.embed_model or cfg.get("embed_model")
    if args.embedder and args.embedder != cfg.get("embedder"):
        raise SystemExit(
            f"Index was built with embedder '{cfg.get('embedder')}' but --embedder "
            f"'{args.embedder}' was requested; vectors would be incomparable."
        )
    # For local/openai, embed_model is a hint; the hash embedder ignores it.
    embed_fn, _, _ = rc.make_embedder(embedder, embed_model if embedder != "hash" else None)

    collection = rc.open_collection(db_path, args.collection, create=False)

    where = None
    if args.where:
        try:
            where = json.loads(args.where)
        except json.JSONDecodeError as e:
            raise SystemExit(f"--where must be valid JSON: {e}")
    if args.scope:
        ids = [x.strip() for x in args.scope.split(",") if x.strip()]
        scope_filter = {"source_file_id": {"$in": ids}} if len(ids) > 1 else {"source_file_id": ids[0]}
        where = scope_filter if where is None else {"$and": [where, scope_filter]}

    q_emb = embed_fn([args.query])
    res = collection.query(
        query_embeddings=q_emb,
        n_results=args.k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    docs = (res.get("documents") or [[]])[0]
    metas = (res.get("metadatas") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]

    results = []
    for doc, meta, dist in zip(docs, metas, dists):
        meta = meta or {}
        results.append(
            {
                "source_file_id": meta.get("source_file_id", ""),
                "chapter": meta.get("chapter", ""),
                "display_name": meta.get("display_name", ""),
                "source_path": meta.get("source_path", ""),
                "line_start": meta.get("line_start"),
                "line_end": meta.get("line_end"),
                "distance": round(dist, 4) if isinstance(dist, (int, float)) else dist,
                "text": doc,
            }
        )

    if args.json:
        print(json.dumps(
            {"query": args.query, "k": args.k, "embedder": embedder, "results": results},
            indent=2, ensure_ascii=False,
        ))
        return 0

    if not results:
        print(f'No passages retrieved for: "{args.query}"')
        return 0

    print(f'# Retrieved {len(results)} passage(s) for: "{args.query}"')
    print(f"# index={db_path} embedder={embedder}\n")
    for rank, r in enumerate(results, start=1):
        loc = r["display_name"] or r["source_file_id"]
        line = ""
        if r["line_start"]:
            line = f" (lines {r['line_start']}–{r['line_end']})"
        print(f"## [{rank}] {r['source_file_id']} · {loc}{line} · distance={r['distance']}")
        print(_shorten(r["text"], args.max_chars))
        print()
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="rag_query",
        description="Retrieve the manuscript passages most relevant to a query.",
    )
    p.add_argument("--query", required=True, help="The retrieval query text.")
    p.add_argument("--db", type=Path, required=True,
                   help="Index directory built by rag_index.py.")
    p.add_argument("--collection", default=rc.DEFAULT_COLLECTION,
                   help=f"Collection name (default {rc.DEFAULT_COLLECTION}).")
    p.add_argument("--k", type=int, default=8, help="Number of passages (default 8).")
    p.add_argument("--scope", default=None,
                   help="Restrict to source IDs, e.g. 'ch07' or 'ch07,ch08'.")
    p.add_argument("--where", default=None,
                   help="Raw ChromaDB metadata filter as JSON, e.g. '{\"chapter\": \"07\"}'.")
    p.add_argument("--max-chars", type=int, default=0,
                   help="Truncate each passage to N chars in text output (0 = full).")
    p.add_argument("--embedder", default=None, choices=[None, "local", "openai", "hash"],
                   help="Override the embedder (must match how the index was built).")
    p.add_argument("--embed-model", default=None, help="Override the embedding model name.")
    p.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    p.add_argument("--verbose", "-v", action="store_true")
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.verbose:
        logger.setLevel(10)
    if not args.db.exists():
        raise SystemExit(f"--db does not exist: {args.db}. Build it with rag_index.py first.")
    if args.k <= 0:
        raise SystemExit("--k must be positive")
    return run_query(args)


if __name__ == "__main__":
    sys.exit(main())
