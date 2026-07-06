#!/usr/bin/env python
"""Query the Dragon Wings canon collection.

Usage:
    .venv/bin/python query.py "who is Maereth" -k 5
    .venv/bin/python query.py "hazirawn voice" --json
    .venv/bin/python query.py --stats
"""
import argparse
import json
import sys
import time

import raglib


def run_query(q: str, k: int = 5) -> dict:
    t0 = time.time()
    col = raglib.get_collection(create=True)  # empty index -> zero results, not an error
    res = col.query(query_texts=[q], n_results=k)
    latency_ms = round((time.time() - t0) * 1000)
    results = []
    for doc, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0]):
        results.append(
            {
                "source": meta["source"],
                "book": meta["book"],
                "title": meta["title"],
                "heading": meta.get("heading") or "",
                "chunk": meta["chunk"],
                "distance": round(dist, 4),
                "score": round(1 - dist, 4),
                "text": doc,
                "approx_tokens": max(1, len(doc) // 4),
            }
        )
    return {"query": q, "k": k, "latency_ms": latency_ms, "results": results}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("query", nargs="?", default=None)
    ap.add_argument("-k", type=int, default=5, help="number of chunks to retrieve")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of readable text")
    ap.add_argument("--stats", action="store_true", help="print collection stats and exit")
    args = ap.parse_args()

    if args.stats:
        col = raglib.get_collection()
        print(json.dumps({"collection": raglib.COLLECTION, "chunks": col.count()}))
        return
    if not args.query:
        ap.error("query required unless --stats")

    payload = run_query(args.query, args.k)
    if args.json:
        json.dump(payload, sys.stdout, ensure_ascii=False)
        return

    print(f"[{payload['latency_ms']} ms] top {args.k} for: {args.query}\n")
    for r in payload["results"]:
        head = f" § {r['heading']}" if r["heading"] else ""
        preview = r["text"][:220].replace("\n", " ")
        print(f"— {r['source']}{head}  (score {r['score']}, ~{r['approx_tokens']} tok)")
        print(f"  {preview}…\n")


if __name__ == "__main__":
    main()
