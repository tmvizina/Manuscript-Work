#!/usr/bin/env python3
"""rag_common.py — shared helpers for the manuscript RAG index.

This module is the plumbing behind `rag_index.py` (build/update the index) and
`rag_query.py` (retrieve passages). It is intentionally thin: the heavy lifting
(vector store, ANN search) is ChromaDB's; everything here is about turning a
manuscript into clean, citable passages and embedding them cheaply.

Design notes
------------
* **Original prose in, original prose out.** Unlike the audiobook chunker, this
  indexer does NOT strip Markdown or apply pronunciation respellings — the
  reviewer needs to read and cite the manuscript as written. Normalization is
  limited to BOM/newline/Unicode hygiene.
* **Explicit embeddings.** We compute vectors ourselves and hand ChromaDB
  `embeddings=` on add and `query_embeddings=` on query, rather than registering
  a ChromaDB EmbeddingFunction on the collection. This keeps us decoupled from
  ChromaDB's per-version embedding-function-persistence quirks and lets the
  `hash` embedder (offline, deterministic) share one code path with the real
  local/OpenAI embedders.
* **Local embeddings by default.** The default embedder is ChromaDB's bundled
  ONNX MiniLM (`local`), which runs on CPU with no API key and no per-query
  cost. That is the whole point: retrieval is free, and only the handful of
  retrieved passages are sent to the (expensive) review model.

Only `chromadb` is a third-party dependency, and only the store helpers need it;
the splitter/embedder helpers are import-safe without it.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def get_logger(name: str = "manuscript_rag") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logger.addHandler(h)
        logger.setLevel(logging.INFO)
    return logger


logger = get_logger()

DEFAULT_COLLECTION = "manuscript"
DEFAULT_DB_DIRNAME = ".rag-index"
DEFAULT_TARGET_CHARS = 1200
DEFAULT_OVERLAP_CHARS = 200
HASH_EMBED_DIM = 384  # matches MiniLM dim so a store isn't accidentally mixed


# ---------------------------------------------------------------------------
# Hashing / chapter detection (kept consistent with the audiobook chunker)
# ---------------------------------------------------------------------------

def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


_CHAPTER_FROM_NAME_RE = re.compile(
    r"chapter\s*0*(\d+(?:\.\d+)?)|^ch0*(\d+(?:\.\d+)?)|^chap0*(\d+(?:\.\d+)?)",
    re.IGNORECASE,
)


def detect_chapter_from_name(path: Path) -> Optional[str]:
    """`Chapter 07 - Foo.txt` -> "07"; `Chapter 07.5 - Bar.txt` -> "07_5`.

    Mirrors the chunker so a chapter carries the same id across both tools.
    """
    m = _CHAPTER_FROM_NAME_RE.search(path.stem)
    if not m:
        return None
    num_str = next((g for g in m.groups() if g), None)
    if num_str is None:
        return None
    if "." in num_str:
        whole, dec = num_str.split(".", 1)
        return f"{int(whole):02d}_{dec}"
    return f"{int(num_str):02d}"


def source_id_for(path: Path, index_among_files: int) -> Tuple[str, Optional[str]]:
    chap = detect_chapter_from_name(path)
    if chap is not None:
        return f"ch{chap}", chap
    return f"file{index_among_files + 1:03d}", None


# ---------------------------------------------------------------------------
# Normalization (light — preserve prose)
# ---------------------------------------------------------------------------

_BOM = "﻿"
_MULTI_BLANK_RE = re.compile(r"\n\s*\n\s*\n+")
_TRAILING_WS_RE = re.compile(r"[ \t]+\n")


def normalize_text(text: str) -> str:
    text = text.replace(_BOM, "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = unicodedata.normalize("NFKC", text)
    text = _TRAILING_WS_RE.sub("\n", text)
    text = _MULTI_BLANK_RE.sub("\n\n", text)
    return text.strip("\n") + "\n"


# ---------------------------------------------------------------------------
# Sentence-aware passage splitting with overlap
# ---------------------------------------------------------------------------

_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "e.g", "i.e",
    "prof", "rev", "fr", "gen", "col", "capt", "lt", "sgt", "no", "vol",
    "ave", "blvd", "rd", "mt", "fig", "inc",
}
_PARA_SPLIT_RE = re.compile(r"\n\s*\n+")
_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[“‘]?[A-Z0-9])")


@dataclass
class _Sentence:
    text: str
    char_start: int
    char_end: int


def _split_sentences(paragraph: str) -> List[str]:
    paragraph = paragraph.strip()
    if not paragraph:
        return []
    candidates = _SENT_SPLIT_RE.split(paragraph)
    out: List[str] = []
    buf = ""
    for piece in candidates:
        piece = piece.strip()
        if not piece:
            continue
        if buf:
            last_token = buf.split()[-1].rstrip(".").lower()
            if last_token in _ABBREVIATIONS:
                buf = f"{buf} {piece}"
                continue
            out.append(buf)
            buf = piece
        else:
            buf = piece
    if buf:
        out.append(buf)
    return out


def _sentence_stream(normalized: str) -> List[_Sentence]:
    """Ordered sentences with char offsets into `normalized`."""
    sents: List[_Sentence] = []
    cursor = 0
    for para in [p for p in _PARA_SPLIT_RE.split(normalized)]:
        stripped = para.strip()
        if not stripped:
            continue
        p_idx = normalized.find(stripped, cursor)
        if p_idx < 0:
            p_idx = cursor
        cursor = p_idx + len(stripped)
        local = p_idx
        for s in _split_sentences(stripped):
            s_idx = normalized.find(s, local)
            if s_idx < 0:
                s_idx = local
            sents.append(_Sentence(text=s, char_start=s_idx, char_end=s_idx + len(s)))
            local = s_idx + len(s)
    return sents


@dataclass
class Passage:
    text: str
    char_start: int
    char_end: int
    line_start: int
    line_end: int
    sentence_count: int


def _line_of(char_index: int, newline_positions: Sequence[int]) -> int:
    """1-based line number for a char offset, via bisect over newline offsets."""
    lo, hi = 0, len(newline_positions)
    while lo < hi:
        mid = (lo + hi) // 2
        if newline_positions[mid] < char_index:
            lo = mid + 1
        else:
            hi = mid
    return lo + 1


def split_passages(
    normalized: str,
    target_chars: int = DEFAULT_TARGET_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> List[Passage]:
    """Greedily pack sentences into ~target_chars passages, never splitting a
    sentence, with a trailing `overlap_chars` of sentences repeated at the head
    of the next passage so a retrieved passage keeps its lead-in context.

    A single sentence longer than target_chars becomes its own passage (we never
    cut mid-sentence — clean citations matter more than uniform size here).
    """
    sents = _sentence_stream(normalized)
    if not sents:
        return []
    newline_positions = [i for i, ch in enumerate(normalized) if ch == "\n"]

    passages: List[Passage] = []
    i = 0
    n = len(sents)
    while i < n:
        buf: List[_Sentence] = []
        cur = 0
        j = i
        while j < n:
            s = sents[j]
            add = len(s.text) + (1 if buf else 0)
            if buf and cur + add > target_chars:
                break
            buf.append(s)
            cur += add
            j += 1
        if not buf:  # single over-long sentence
            buf = [sents[i]]
            j = i + 1

        text = " ".join(s.text for s in buf)
        cs, ce = buf[0].char_start, buf[-1].char_end
        passages.append(
            Passage(
                text=text,
                char_start=cs,
                char_end=ce,
                line_start=_line_of(cs, newline_positions),
                line_end=_line_of(ce, newline_positions),
                sentence_count=len(buf),
            )
        )
        if j >= n:
            break

        # Compute overlap: back up from the end of this passage far enough to
        # cover `overlap_chars`, but always advance by at least one sentence so
        # we cannot loop forever.
        next_start = j
        if overlap_chars > 0:
            acc = 0
            k = j - 1
            while k > i and acc < overlap_chars:
                acc += len(buf[k - i].text) + 1
                k -= 1
            next_start = max(i + 1, k + 1)
        i = next_start
    return passages


# ---------------------------------------------------------------------------
# Embedders — all present the same interface: List[str] -> List[List[float]]
# ---------------------------------------------------------------------------

Embedder = Callable[[List[str]], List[List[float]]]


def _to_float_lists(vectors) -> List[List[float]]:
    """Coerce whatever a ChromaDB EmbeddingFunction returns (numpy arrays, lists
    of np.float32, etc.) into plain python `List[List[float]]`, which is what the
    add/query record validators accept across ChromaDB versions."""
    return [[float(x) for x in vec] for vec in vectors]


LOCAL_DEFAULT_MODEL = "all-MiniLM-L6-v2"          # ChromaDB bundled ONNX
OPENAI_DEFAULT_MODEL = "text-embedding-3-small"    # cheap, 1536-dim


def _hash_embedder(dim: int = HASH_EMBED_DIM) -> Embedder:
    """Deterministic, dependency-free bag-of-words hashing embedder.

    NOT for production retrieval quality — it only captures lexical overlap — but
    it makes the whole pipeline runnable and testable offline (no model download,
    no API key). Selected with `--embedder hash`.
    """
    token_re = re.compile(r"[A-Za-z0-9']+")

    def embed(texts: List[str]) -> List[List[float]]:
        out: List[List[float]] = []
        for t in texts:
            vec = [0.0] * dim
            for tok in token_re.findall(t.lower()):
                h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
                vec[h % dim] += 1.0
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        return out

    return embed


def make_embedder(
    kind: str = "local",
    model: Optional[str] = None,
) -> Tuple[Embedder, str, str]:
    """Return (embed_fn, resolved_kind, resolved_model).

    kinds:
      * "local"  — ChromaDB's bundled ONNX MiniLM (no API key, no per-call cost).
      * "openai" — OpenAI embeddings API (needs OPENAI_API_KEY; cheap but not free).
      * "hash"   — deterministic offline test embedder (low quality; CI/smoke only).
    """
    kind = (kind or "local").lower()
    if kind == "hash":
        return _hash_embedder(), "hash", f"hash-{HASH_EMBED_DIM}"

    if kind == "local":
        resolved = model or LOCAL_DEFAULT_MODEL
        try:
            from chromadb.utils import embedding_functions
        except ImportError as e:  # pragma: no cover - env dependent
            raise SystemExit(
                "ChromaDB is required for the 'local' embedder. Install it with "
                "`pip install chromadb`, or use `--embedder hash` for an offline "
                "smoke test."
            ) from e
        try:
            ef = embedding_functions.DefaultEmbeddingFunction()
        except Exception as e:  # pragma: no cover - env dependent
            raise SystemExit(
                "Could not initialize the local ONNX embedding model "
                f"({resolved}). It downloads once on first use; if this machine "
                "has no network, pre-cache the model or use `--embedder openai` / "
                f"`--embedder hash`. Underlying error: {e}"
            ) from e
        return (lambda texts: _to_float_lists(ef(texts))), "local", resolved

    if kind == "openai":
        resolved = model or OPENAI_DEFAULT_MODEL
        import os
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise SystemExit(
                "--embedder openai needs OPENAI_API_KEY in the environment."
            )
        try:
            from chromadb.utils import embedding_functions
        except ImportError as e:  # pragma: no cover
            raise SystemExit("`pip install chromadb` to use the openai embedder.") from e
        ef = embedding_functions.OpenAIEmbeddingFunction(
            api_key=api_key, model_name=resolved
        )
        return (lambda texts: _to_float_lists(ef(texts))), "openai", resolved

    raise SystemExit(f"Unknown --embedder '{kind}'. Use local | openai | hash.")


# ---------------------------------------------------------------------------
# ChromaDB store helpers
# ---------------------------------------------------------------------------

def require_chromadb():
    try:
        import chromadb  # noqa: F401
        return chromadb
    except ImportError as e:  # pragma: no cover - env dependent
        raise SystemExit(
            "ChromaDB is not installed. Install it with `pip install chromadb` "
            "(see skills/manuscript-rag/requirements.txt)."
        ) from e


def open_collection(db_path: Path, name: str, create: bool = True):
    """Open (or create) a persistent collection. We pass embeddings explicitly on
    every add/query, so no embedding function is attached to the collection."""
    chromadb = require_chromadb()
    from chromadb.config import Settings as ChromaSettings

    db_path.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(
        path=str(db_path),
        settings=ChromaSettings(anonymized_telemetry=False, allow_reset=False),
    )
    if create:
        return client.get_or_create_collection(name=name, metadata={"hnsw:space": "cosine"})
    return client.get_collection(name=name)


def passage_id(source_id: str, index: int) -> str:
    return f"{source_id}::{index:04d}"
