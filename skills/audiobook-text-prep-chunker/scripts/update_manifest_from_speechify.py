#!/usr/bin/env python3
"""update_manifest_from_speechify.py

Bridge between the chunker's `chunk_manifest.json` and the output of
`speechify_batch_tts.py`.

After Speechify generation finishes, this script walks the Speechify output
directory for `<chunk_id>.mp3` files and writes each path back into the
matching chunk's pre-allocated `speechify.*` block in the chunker manifest.
The audit + repair stages downstream read those slots, so this step is what
makes the pipeline manifest-coherent end-to-end.

Stdlib only — no third-party dependencies.

Usage:

    python update_manifest_from_speechify.py \\
        --manifest prepared_audiobook/chunk_manifest.json \\
        --speechify-output /Users/tmvizina/Documents/ChapterText/next\\ pass/audio

By default writes the result to `<manifest>.updated.json` so the original
manifest is preserved. Pass `--in-place` to overwrite.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# Filename extensions to consider for the audio search.
AUDIO_EXTS = (".mp3", ".wav", ".flac", ".m4a", ".ogg")


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat(timespec="seconds")


def _find_audio_file(chunk_id: str, audio_dir: Path) -> Optional[Path]:
    """Look for <chunk_id>.<ext> directly under `audio_dir`."""
    for ext in AUDIO_EXTS:
        candidate = audio_dir / f"{chunk_id}{ext}"
        if candidate.exists():
            return candidate
    return None


def _load_speechify_chapter_manifest(
    chunk_id: str,
    manifests_dir: Optional[Path],
) -> Optional[dict]:
    """Speechify's per-input manifest lives at `<output>/manifests/<stem>.manifest.json`."""
    if manifests_dir is None or not manifests_dir.is_dir():
        return None
    path = manifests_dir / f"{chunk_id}.manifest.json"
    if not path.exists():
        return None
    try:
        return _load(path)
    except Exception:  # noqa: BLE001
        return None


def _resolve_speechify_dirs(speechify_output: Path) -> tuple[Path, Optional[Path]]:
    """Speechify writes:
        <output>/final/<stem>.mp3        ← stitched MP3 (what we want)
        <output>/chunks/<stem>/...       ← per-call parts (ignored)
        <output>/manifests/<stem>.manifest.json
    """
    final_dir = speechify_output / "final"
    manifests_dir = speechify_output / "manifests"
    if not final_dir.is_dir():
        # Allow user to point directly at the directory of MP3s.
        final_dir = speechify_output
    return final_dir, manifests_dir if manifests_dir.is_dir() else None


def update_manifest(
    manifest_path: Path,
    speechify_output: Path,
    *,
    voice_id_override: Optional[str] = None,
    model_override: Optional[str] = None,
    output_format_override: Optional[str] = None,
) -> tuple[dict, dict]:
    """Returns (updated_manifest, summary)."""
    manifest = _load(manifest_path)
    audio_dir, manifests_dir = _resolve_speechify_dirs(speechify_output)

    summary = {
        "manifest": str(manifest_path),
        "speechify_audio_dir": str(audio_dir),
        "speechify_manifests_dir": str(manifests_dir) if manifests_dir else None,
        "chunks_total": 0,
        "chunks_audio_found": 0,
        "chunks_audio_missing": 0,
        "missing_chunk_ids": [],
    }

    chunks = manifest.get("chunks") or []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        summary["chunks_total"] += 1
        chunk_id = chunk.get("chunk_id")
        if not chunk_id:
            continue

        audio_path = _find_audio_file(chunk_id, audio_dir)
        speechify_block = chunk.setdefault("speechify", {})

        # Pull voice_id/model/output_format from Speechify's own manifest first.
        sp_chapter = _load_speechify_chapter_manifest(chunk_id, manifests_dir)
        voice_id = (
            voice_id_override
            or (sp_chapter or {}).get("voice_id")
            or speechify_block.get("voice_id")
        )
        model = (
            model_override
            or (sp_chapter or {}).get("model")
            or speechify_block.get("model")
        )
        output_format = (
            output_format_override
            or speechify_block.get("audio_format")
            or (audio_path.suffix.lstrip(".") if audio_path else "mp3")
        )

        if voice_id:
            speechify_block["voice_id"] = voice_id
        if model:
            speechify_block["model"] = model
        speechify_block["audio_format"] = output_format

        if audio_path is None:
            summary["chunks_audio_missing"] += 1
            summary["missing_chunk_ids"].append(chunk_id)
            # Don't clobber a previously-recorded success.
            speechify_block.setdefault("status", "not_generated")
            continue

        # Found audio — record success.
        summary["chunks_audio_found"] += 1
        speechify_block["status"] = "generated"
        speechify_block["audio_file"] = str(audio_path.resolve())
        speechify_block["completed_at"] = _iso(audio_path.stat().st_mtime)
        speechify_block["billable_characters"] = chunk.get("character_count")
        # Append an attempt record without clobbering history.
        attempts = speechify_block.setdefault("generation_attempts", [])
        attempts.append({
            "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "provider": "speechify",
            "success": True,
            "audio_file": str(audio_path.resolve()),
            "source": "update_manifest_from_speechify.py",
        })

    return manifest, summary


def write_summary_md(path: Path, summary: dict) -> None:
    lines = [
        "# Speechify Manifest Update Summary\n",
        f"_Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}_\n",
        f"- Manifest: `{summary['manifest']}`",
        f"- Speechify audio dir: `{summary['speechify_audio_dir']}`",
        f"- Speechify manifests dir: `{summary['speechify_manifests_dir'] or '—'}`",
        f"- Total chunks: **{summary['chunks_total']}**",
        f"- Audio matched: **{summary['chunks_audio_found']}**",
        f"- Audio missing: **{summary['chunks_audio_missing']}**",
    ]
    if summary["missing_chunk_ids"]:
        lines.append("\n## Chunks still missing audio\n")
        for cid in summary["missing_chunk_ids"]:
            lines.append(f"- `{cid}`")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="update_manifest_from_speechify",
        description=(
            "Update the chunker's chunk_manifest.json with audio paths from "
            "speechify_batch_tts.py output. Stdlib only."
        ),
    )
    p.add_argument("--manifest", type=Path, required=True,
                   help="Path to chunk_manifest.json (from audiobook-text-prep-chunker).")
    p.add_argument("--speechify-output", type=Path, required=True,
                   help="The directory you passed to `speechify_batch_tts.py --output`. "
                        "Should contain a `final/` subdirectory.")
    p.add_argument("--voice-id", default=None,
                   help="Override voice_id written into each chunk's speechify block.")
    p.add_argument("--model", default=None,
                   help="Override model written into each chunk's speechify block.")
    p.add_argument("--output-format", default=None,
                   help="Override audio_format (defaults to detected file extension).")
    p.add_argument("--in-place", action="store_true",
                   help="Overwrite the manifest in place. Default writes <manifest>.updated.json.")
    p.add_argument("--summary", type=Path, default=None,
                   help="Optional path for a Markdown summary (default: alongside output manifest).")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    if not args.manifest.exists():
        print(f"ERROR: manifest not found: {args.manifest}", file=sys.stderr)
        return 2
    if not args.speechify_output.exists():
        print(f"ERROR: speechify output dir not found: {args.speechify_output}", file=sys.stderr)
        return 2

    updated, summary = update_manifest(
        args.manifest,
        args.speechify_output,
        voice_id_override=args.voice_id,
        model_override=args.model,
        output_format_override=args.output_format,
    )

    if args.in_place:
        out_path = args.manifest
    else:
        out_path = args.manifest.with_suffix(".updated.json")
    _write(out_path, updated)

    summary_path = args.summary or out_path.with_name(out_path.stem + "_update_summary.md")
    write_summary_md(summary_path, summary)

    print(
        f"Updated {summary['chunks_audio_found']}/{summary['chunks_total']} chunks "
        f"({summary['chunks_audio_missing']} missing)."
    )
    print(f"Wrote manifest:  {out_path}")
    print(f"Wrote summary:   {summary_path}")
    return 0 if summary["chunks_audio_missing"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
