#!/usr/bin/env python
"""Tiny HTTP wrapper around the canon RAG, for running inside the container.

  GET  /health           -> {"ok": true, "chunks": N}
  GET  /query?q=...&k=5  -> query.run_query() JSON (+ "ok": true)
  POST /ingest           -> re-scan the corpus and rebuild the index
                            {"ok": true, "files": N, "chunks": N, "seconds": S}

Single chroma client behind a lock; queries are ~100ms so serialization is fine
for a handful of concurrent annotation workers. Ingest holds the lock for its
whole run (minutes on a full book) — health/query requests queue behind it.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import raglib
from ingest import run_ingest
from query import run_query

PORT = 8801
LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            try:
                with LOCK:
                    col = raglib.get_collection(create=True)
                    self._send(200, {"ok": True, "chunks": col.count()})
            except Exception as e:
                self._send(500, {"ok": False, "error": str(e)})
            return
        if u.path == "/query":
            qs = parse_qs(u.query)
            q = (qs.get("q") or [""])[0].strip()
            try:
                k = int((qs.get("k") or ["5"])[0])
            except ValueError:
                k = 5
            if not q:
                self._send(400, {"ok": False, "error": "missing q"})
                return
            try:
                with LOCK:
                    res = run_query(q, max(1, min(k, 20)))
                res["ok"] = True
                self._send(200, res)
            except Exception as e:
                self._send(500, {"ok": False, "error": str(e)})
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/ingest":
            try:
                with LOCK:
                    res = run_ingest(rebuild=True, quiet=True)
                res["ok"] = True
                self._send(200, res)
            except Exception as e:
                self._send(500, {"ok": False, "error": str(e)})
            return
        self._send(404, {"ok": False, "error": "not found"})

    def log_message(self, *args):  # keep container logs quiet
        pass


if __name__ == "__main__":
    with LOCK:
        col = raglib.get_collection(create=True)
        if col.count():
            col.query(query_texts=["warmup"], n_results=1)
        print(f"rag serve ready: {col.count()} chunks on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
