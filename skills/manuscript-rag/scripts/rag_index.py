#!/usr/bin/env python3
"""rag_index.py — build/update a ChromaDB index of a manuscript.

Splits chapter `.txt` files into sentence-aware passages, embeds them locally
(by default — no API cost), and stores them in a persistent ChromaDB collection
so the reviewer can retrieve only the passages relevant to a query instead of
loading the whole book into context.

Incremental by default: each chapter is fingerprinted (source_hash). A chapter
whose text is unchanged since the last index is skipped; a changed chapter has
its old passages deleted and re-embedded. Nothing else is touched.

    # First build (writes ./.rag-index next to the chapters)
    python rag_index.py --source chapters/

    # Re-index after edits — only changed chapters are re-embedded
    python rag_index.py --source chapters/

    # Offline smoke test with the deterministic hash embedder
    python rag_index.py --source chapters/ --embedder hash

Only `chromadb` is required (see requirements.txt); everything else is stdlib.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional, Sequence

import rag_common as rc

logger = rc.logger


def discover_inputs(input_path: Path) -> List[Path]:
    if input_path.is_file():
        if input_path.suffix.lower() != ".txt":
            raise SystemExit(f"--source file must be .txt: {input_path}")
        return [input_path]
    if input_path.is_dir():
        files = sorted(
            p for p in input_path.iterdir() if p.is_file() and p.suffix.lower() == ".txt"
        )
        if not files:
            raise SystemExit(f"No .txt files found in {input_path}")
        return files
    raise SystemExit(f"--source not found: {input_path}")


def _existing_source_hash(collection, source_id: str) -> Optional[str]:
    """Return the stored source_hash for a chapter if it is already indexed."""
    got = collection.get(where={"source_file_id": source_id}, limit=1, include=["metadatas"])
    metas = got.get("metadatas") or []
    if metas and metas[0]:
        return metas[0].get("source_hash")
    return None


def _delete_source(collection, source_id: str) -> None:
    collection.delete(where={"source_file_id": source_id})


def _read_config(db_path: Path) -> Optional[dict]:
    cfg = db_path / "rag_config.json"
    if cfg.is_file():
        try:
            return json.loads(cfg.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return None
    return None


def _write_config(db_path: Path, cfg: dict) -> None:
    (db_path / "rag_config.json").write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def build_index(args: argparse.Namespace) -> int:
    inputs = discover_inputs(args.source)
    db_path: Path = args.db
    scope = None
    if args.only:
        scope = {x.strip() for x in args.only.split(",") if x.strip()}

    embed_fn, embed_kind, embed_model = rc.make_embedder(args.embedder, args.embed_model)

    # Guard against silently mixing incompatible vectors in one store: an index
    # built with `local` (MiniLM, 384-d) cannot be queried with `openai` (1536-d),
    # and even same-dim different-model vectors are not comparable.
    prior_cfg = _read_config(db_path) if not args.full else None
    if prior_cfg and (
        prior_cfg.get("embedder") != embed_kind or prior_cfg.get("embed_model") != embed_model
    ):
        raise SystemExit(
            f"Existing index at {db_path} was built with "
            f"embedder={prior_cfg.get('embedder')}/{prior_cfg.get('embed_model')}, "
            f"but you asked for {embed_kind}/{embed_model}. Re-embedding with a "
            f"different model requires --full (rebuilds the whole index)."
        )

    if args.full and db_path.exists():
        logger.info("--full: removing existing index at %s", db_path)
        if not args.dry_run:
            import shutil

            shutil.rmtree(db_path, ignore_errors=True)

    # A dry-run against a path with no existing index must not create one. We
    # still open an existing store (read-only in effect) so we can report
    # unchanged-vs-changed accurately.
    db_exists = (db_path / "chroma.sqlite3").exists()
    open_store = (not args.dry_run) or db_exists
    collection = rc.open_collection(db_path, args.collection, create=True) if open_store else None

    total_passages = 0
    total_added = 0
    rows: List[dict] = []

    for idx, path in enumerate(inputs):
        source_id, detected_chap = rc.source_id_for(path, idx)
        if scope is not None and source_id not in scope:
            continue

        try:
            raw = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            logger.warning("%s: not UTF-8, retrying latin-1", path)
            raw = path.read_text(encoding="latin-1")
        normalized = rc.normalize_text(raw)
        src_hash = rc.sha256(normalized)

        prior_hash = None
        if collection is not None and not args.full:
            prior_hash = _existing_source_hash(collection, source_id)
        if prior_hash == src_hash:
            rows.append({"source_file_id": source_id, "status": "unchanged", "passages": 0})
            logger.info("%-10s unchanged — skipped", source_id)
            continue

        passages = rc.split_passages(normalized, args.target_chars, args.overlap_chars)
        total_passages += len(passages)
        rows.append(
            {
                "source_file_id": source_id,
                "status": "reindexed" if prior_hash else "new",
                "passages": len(passages),
            }
        )

        if args.dry_run:
            logger.info("%-10s %s — %d passage(s) [dry-run]", source_id,
                        "reindex" if prior_hash else "new", len(passages))
            continue

        if prior_hash:
            _delete_source(collection, source_id)

        ids = [rc.passage_id(source_id, i) for i in range(len(passages))]
        documents = [p.text for p in passages]
        metadatas = [
            {
                "source_file_id": source_id,
                "chapter": detected_chap or "",
                "source_path": str(path),
                "display_name": path.stem,
                "passage_index": i,
                "char_start": p.char_start,
                "char_end": p.char_end,
                "line_start": p.line_start,
                "line_end": p.line_end,
                "sentence_count": p.sentence_count,
                "source_hash": src_hash,
            }
            for i, p in enumerate(passages)
        ]
        embeddings = embed_fn(documents)

        # Add in batches to stay well under ChromaDB's max batch size.
        BATCH = 256
        for b in range(0, len(ids), BATCH):
            sl = slice(b, b + BATCH)
            collection.add(
                ids=ids[sl],
                documents=documents[sl],
                metadatas=metadatas[sl],
                embeddings=embeddings[sl],
            )
        total_added += len(ids)
        logger.info("%-10s %s — %d passage(s) embedded", source_id,
                    "reindexed" if prior_hash else "indexed", len(passages))

    if not args.dry_run:
        _write_config(
            db_path,
            {
                "collection": args.collection,
                "embedder": embed_kind,
                "embed_model": embed_model,
                "target_chars": args.target_chars,
                "overlap_chars": args.overlap_chars,
            },
        )
        try:
            count = collection.count()
        except Exception:  # noqa: BLE001
            count = total_added
        logger.info(
            "Index at %s now holds %d passage(s) across the collection '%s' "
            "(embedder=%s/%s). Added/updated %d this run.",
            db_path, count, args.collection, embed_kind, embed_model, total_added,
        )
    else:
        logger.info("[dry-run] would embed %d passage(s); no writes made.", total_passages)

    # Machine-readable run report.
    report = {
        "db": str(db_path),
        "collection": args.collection,
        "embedder": embed_kind,
        "embed_model": embed_model,
        "dry_run": bool(args.dry_run),
        "sources": rows,
        "passages_added": total_added,
    }
    if args.report:
        Path(args.report).write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="rag_index",
        description="Build/update a ChromaDB passage index of a manuscript.",
    )
    p.add_argument("--source", type=Path, required=True,
                   help="A chapter .txt file OR a directory of chapter .txt files.")
    p.add_argument("--db", type=Path, default=None,
                   help=f"Index directory (ChromaDB persist path). "
                        f"Default: <source-dir>/{rc.DEFAULT_DB_DIRNAME}.")
    p.add_argument("--collection", default=rc.DEFAULT_COLLECTION,
                   help=f"Collection name (default {rc.DEFAULT_COLLECTION}).")
    p.add_argument("--embedder", default="local", choices=["local", "openai", "hash"],
                   help="local = bundled ONNX MiniLM (no API cost, default); "
                        "openai = OpenAI embeddings (needs OPENAI_API_KEY); "
                        "hash = deterministic offline test embedder.")
    p.add_argument("--embed-model", default=None,
                   help="Override the embedding model name for the chosen embedder.")
    p.add_argument("--target-chars", type=int, default=rc.DEFAULT_TARGET_CHARS,
                   help=f"Approx passage size (default {rc.DEFAULT_TARGET_CHARS}).")
    p.add_argument("--overlap-chars", type=int, default=rc.DEFAULT_OVERLAP_CHARS,
                   help=f"Overlap between adjacent passages (default {rc.DEFAULT_OVERLAP_CHARS}).")
    p.add_argument("--only", default=None,
                   help="Comma-separated source IDs to (re)index, e.g. 'ch07' or 'ch07,ch08'.")
    p.add_argument("--full", action="store_true",
                   help="Rebuild the whole index from scratch (required to change embedder/model).")
    p.add_argument("--dry-run", action="store_true",
                   help="Report what would be indexed without writing the store.")
    p.add_argument("--report", default=None,
                   help="Write a JSON run report to this path.")
    p.add_argument("--verbose", "-v", action="store_true")
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.verbose:
        logger.setLevel(10)
    if not args.source.exists():
        raise SystemExit(f"--source does not exist: {args.source}")
    if args.db is None:
        base = args.source if args.source.is_dir() else args.source.parent
        args.db = base / rc.DEFAULT_DB_DIRNAME
        logger.info("Using default --db: %s", args.db)
    if args.target_chars <= 0:
        raise SystemExit("--target-chars must be positive")
    if args.overlap_chars < 0 or args.overlap_chars >= args.target_chars:
        raise SystemExit("--overlap-chars must be >= 0 and < --target-chars")
    return build_index(args)


if __name__ == "__main__":
    sys.exit(main())
