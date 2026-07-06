"""Shared corpus discovery, chunking, and Chroma client config for the Dragon Wings canon RAG.

Corpus = world/ (canon memory, .md) + Book 1 chapters + Book 2 chapters + prequel chapters (.txt).
"""
from __future__ import annotations

import os
import re
from pathlib import Path

# The manuscript repo the corpus lives in. Defaults to this repo's root (the POC
# layout, where rag/ sat inside the manuscript repo); set RAG_REPO_ROOT to index
# a manuscript checkout that lives elsewhere.
REPO_ROOT = Path(os.environ.get("RAG_REPO_ROOT") or Path(__file__).resolve().parents[1]).resolve()
DB_DIR = Path(__file__).resolve().parent / "chroma_db"
COLLECTION = "dragonwings_canon"

CORPUS_SPECS = [
    ("world", REPO_ROOT / "world", (".md",)),
    ("book-1", REPO_ROOT / "chapters", (".txt",)),
    ("book-2", REPO_ROOT / "book-2" / "chapters", (".txt",)),
    ("prequel", REPO_ROOT / "prequel-novella" / "chapters", (".txt",)),
]

CHUNK_CHARS = 1200   # soft cap per chunk
OVERLAP_PARAS = 1    # paragraphs of overlap between adjacent chunks


def corpus_files():
    """Yield (book, path) for every corpus file, sorted for stable ids."""
    for book, root, exts in CORPUS_SPECS:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.suffix.lower() in exts:
                yield book, p


def _split_long(para: str, limit: int) -> list[str]:
    """Split an oversize paragraph on sentence boundaries so chunks stay bounded."""
    if len(para) <= limit:
        return [para]
    sents = re.split(r"(?<=[.!?…])\s+", para)
    out, cur = [], ""
    for s in sents:
        if cur and len(cur) + len(s) + 1 > limit:
            out.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        out.append(cur)
    return out


def _paragraphs(text: str) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out = []
    for p in paras:
        out.extend(_split_long(p, CHUNK_CHARS))
    return out


def chunk_file(book: str, path: Path) -> list[dict]:
    """Chunk one file into ~CHUNK_CHARS pieces.

    Markdown files break on headings (heading kept as metadata + context);
    chapter .txt files pack paragraphs with a one-paragraph overlap.
    Returns [{id, text, metadata}].
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    rel = path.relative_to(REPO_ROOT).as_posix()
    title = path.stem
    is_md = path.suffix.lower() == ".md"

    groups: list[tuple[str, list[str]]] = []  # (heading, paragraphs)
    heading = ""
    buf: list[str] = []
    size = 0
    for para in _paragraphs(text):
        m = re.match(r"^(#{1,6})\s+(.*)", para)
        if is_md and m:
            if buf:
                groups.append((heading, buf))
            heading = m.group(2).strip()
            buf, size = [para], len(para)
            continue
        if buf and size + len(para) > CHUNK_CHARS:
            groups.append((heading, buf))
            tail = buf[-OVERLAP_PARAS:] if OVERLAP_PARAS else []
            buf = tail + [para]
            size = sum(len(b) for b in buf)
        else:
            buf.append(para)
            size += len(para)
    if buf:
        groups.append((heading, buf))

    chunks = []
    for i, (h, ps) in enumerate(groups):
        chunks.append(
            {
                "id": f"{rel}::{i}",
                "text": "\n\n".join(ps),
                "metadata": {"source": rel, "book": book, "title": title, "heading": h, "chunk": i},
            }
        )
    return chunks


def get_client():
    """Local PersistentClient by default; set CHROMA_HOST (and optionally
    CHROMA_PORT) to talk to a chromadb server instead (the compose setup)."""
    import chromadb

    host = os.environ.get("CHROMA_HOST")
    if host:
        return chromadb.HttpClient(host=host, port=int(os.environ.get("CHROMA_PORT", "8000")))
    return chromadb.PersistentClient(path=str(DB_DIR))


def get_collection(client=None, create: bool = False):
    client = client or get_client()
    if create:
        return client.get_or_create_collection(name=COLLECTION, metadata={"hnsw:space": "cosine"})
    return client.get_collection(name=COLLECTION)
