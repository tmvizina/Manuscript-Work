#!/usr/bin/env python
"""Persistent RAG worker for the canon-query server.

Protocol: one JSON object per line on stdin: {"id": <any>, "q": "...", "k": 5}
          one JSON object per line on stdout, echoing "id".
On startup emits a status line (no "id"): {"ready": true, "chunks": N}.
Keeping the process alive keeps the embedding model warm, so per-query
latency reflects retrieval, not model load.
"""
import json
import sys

import raglib
from query import run_query


def main():
    try:
        col = raglib.get_collection()
        col.query(query_texts=["warmup"], n_results=1)  # load the embedding model now
        print(json.dumps({"ready": True, "chunks": col.count()}), flush=True)
    except Exception as e:
        print(json.dumps({"ready": False, "error": str(e)}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = None
        try:
            req = json.loads(line)
            res = run_query(req["q"], int(req.get("k", 5)))
            res["id"] = req.get("id")
            res["ok"] = True
        except Exception as e:
            res = {"id": req.get("id") if isinstance(req, dict) else None, "ok": False, "error": str(e)}
        print(json.dumps(res, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
