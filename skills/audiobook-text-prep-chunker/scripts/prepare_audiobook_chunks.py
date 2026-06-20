#!/usr/bin/env python3
"""prepare_audiobook_chunks.py — first stage of the audiobook pipeline.

Reads one or more .txt manuscript files, lightly normalizes them, splits them
into Speechify-ready chunks (target 1500-1800 chars, hard cap 2000), and
writes a chunk manifest with placeholders for downstream Speechify generation,
Whisper validation, and repair tracking.

This script is intentionally stdlib-only.
"""
from __future__ import annotations

import argparse
import copy
import difflib
import hashlib
import json
import logging
import re
import shutil
import sys
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def get_logger(name: str = "audiobook_text_prep") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logger.addHandler(h)
        logger.setLevel(logging.INFO)
    return logger


logger = get_logger()


# ---------------------------------------------------------------------------
# Embedded defaults (override with --input / --out)
# ---------------------------------------------------------------------------
#
# Script lives at tools/audiobook-text-prep-chunker/scripts/ inside the
# RoadBeneathDragonsWings repo. We derive defaults relative to this script's
# location so the chunker works regardless of where the repo is cloned.
#
#   <repo-root>/
#     chapters/                       ← default --input  (Book 1 main book)
#     audiobook-prep/book-1-simba-3.0/ ← default --out  (current production prep)
#     tools/audiobook-text-prep-chunker/scripts/  ← this script
#
# For the prequel or Book 2, pass --input prequel-novella/ --out audiobook-prep/prequel/
# (or --input book-2/chapters/ --out audiobook-prep/book-2/) explicitly. The older
# book-1/ prep dir is still usable via --out audiobook-prep/book-1/.

_SCRIPT_DIR = Path(__file__).resolve().parent          # tools/audiobook-text-prep-chunker/scripts/
_REPO_ROOT  = _SCRIPT_DIR.parent.parent.parent          # <repo-root>/

EMBEDDED_INPUT_DIR: str  = str(_REPO_ROOT / "chapters")
EMBEDDED_OUTPUT_DIR: str = str(_REPO_ROOT / "audiobook-prep" / "book-1-simba-3.0")


# ---------------------------------------------------------------------------
# Models (dataclasses → JSON via asdict)
# ---------------------------------------------------------------------------

@dataclass
class Settings:
    target_min_chars: int = 1500
    target_max_chars: int = 1800
    hard_max_chars: int = 2000
    preserve_paragraphs: bool = True
    preserve_headings: bool = True
    normalize_quotes: bool = False
    normalize_whitespace: bool = True
    strip_markdown: bool = True
    sentence_split_strategy: str = "safe_boundary_first"
    pronunciation_guide_path: Optional[str] = None
    pronunciation_guide_loaded: bool = False
    pronunciation_rules_loaded: int = 0


@dataclass
class PronunciationRule:
    original: str
    replacement: str
    notes: str = ""
    source_line: int = 0


@dataclass
class AppliedSubstitution:
    original: str
    replacement: str
    count: int
    source_file_id: str


@dataclass
class SourceFile:
    source_file_id: str
    path: str
    display_name: str
    detected_chapter: Optional[str]
    source_hash: str
    character_count: int
    estimated_chunks: int
    pronunciation: dict = field(default_factory=dict)


@dataclass
class ChunkContext:
    previous_chunk_id: Optional[str] = None
    next_chunk_id: Optional[str] = None
    first_sentence: str = ""
    last_sentence: str = ""
    previous_context: str = ""
    next_context: str = ""


@dataclass
class SpeechifyBlock:
    status: str = "not_generated"
    voice_id: Optional[str] = None
    model: Optional[str] = None
    audio_format: str = "mp3"
    requested_at: Optional[str] = None
    completed_at: Optional[str] = None
    api_endpoint: str = "/v1/audio/speech"
    billable_characters: Optional[int] = None
    estimated_cost_usd: Optional[float] = None
    audio_file: Optional[str] = None
    speech_marks_file: Optional[str] = None
    api_response_metadata_file: Optional[str] = None
    generation_attempts: List[dict] = field(default_factory=list)


@dataclass
class ValidationBlock:
    status: str = "not_validated"
    whisper_passes: List[dict] = field(default_factory=list)
    overall_similarity: Optional[float] = None
    missing_text_flags: List[dict] = field(default_factory=list)
    artifact_flags: List[dict] = field(default_factory=list)
    human_review_required: bool = False
    approved_for_final: bool = False


@dataclass
class RepairBlock:
    repair_status: str = "not_needed"
    repair_items: List[dict] = field(default_factory=list)
    patched_audio_file: Optional[str] = None
    repair_notes: List[str] = field(default_factory=list)


@dataclass
class Chunk:
    chunk_id: str
    sequence_global: int
    sequence_in_source: int
    source_file_id: str
    source_file: str
    chunk_text_file: Optional[str]
    text: str
    character_count: int
    word_count: int
    paragraph_count: int
    sentence_count: int
    starts_with_heading: bool
    ends_at_sentence_boundary: bool
    ends_at_paragraph_boundary: bool
    forced_sentence_split: bool
    source_start_char: int
    source_end_char: int
    text_hash: str
    context: ChunkContext = field(default_factory=ChunkContext)
    speechify: SpeechifyBlock = field(default_factory=SpeechifyBlock)
    validation: ValidationBlock = field(default_factory=ValidationBlock)
    repair: RepairBlock = field(default_factory=RepairBlock)


@dataclass
class Warning:
    code: str
    message: str
    chunk_id: Optional[str] = None
    source_file_id: Optional[str] = None
    severity: str = "info"  # info | warning | error


@dataclass
class Summary:
    source_file_count: int = 0
    chunk_count: int = 0
    total_characters: int = 0
    average_chunk_characters: int = 0
    min_chunk_characters: int = 0
    max_chunk_characters: int = 0
    chunks_over_target: int = 0
    chunks_under_target: int = 0
    chunks_over_hard_max: int = 0
    sentence_splits_forced: int = 0
    warnings_count: int = 0
    pronunciation_rules_loaded: int = 0
    pronunciation_distinct_terms_applied: int = 0
    pronunciation_substitutions_total: int = 0


@dataclass
class Manifest:
    project: str
    created_at: str
    settings: Settings
    source_files: List[SourceFile]
    chunks: List[Chunk]
    summary: Summary


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

_FOLD_MAP = {
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "–": "-", "—": "-", "‐": "-", "‑": "-",
    "‒": "-", "―": "-",
    "…": "...",
}

_BOM = "﻿"
_MULTI_BLANK_RE = re.compile(r"\n\s*\n\s*\n+")
_TRAILING_WS_RE = re.compile(r"[ \t]+\n")

# Markdown that is meaningless (or harmful) to a plain-text TTS engine. Speechify
# does not interpret Markdown, so these would otherwise be voiced or mangled:
#   * * *  /  ***   → scene-break lines (read as "star star star" or odd pauses)
#   **word** / *word* → emphasis markers (asterisks voiced; emphasis is lost anyway)
_SCENE_BREAK_RE = re.compile(r"(?m)^[ \t]*\*(?:[ \t]*\*)+[ \t]*$")
_EMPHASIS_DOUBLE_RE = re.compile(r"\*\*([^*\n]+?)\*\*")
_EMPHASIS_SINGLE_RE = re.compile(r"(?<!\*)\*([^*\n]+?)\*(?!\*)")


def normalize_source(text: str, settings: Settings) -> str:
    text = text.replace(_BOM, "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = unicodedata.normalize("NFKC", text)
    if settings.normalize_quotes:
        text = "".join(_FOLD_MAP.get(c, c) for c in text)
    if settings.strip_markdown:
        # Drop scene-break lines first (they become a blank line → natural pause),
        # then strip inline emphasis markers, keeping the words.
        text = _SCENE_BREAK_RE.sub("", text)
        text = _EMPHASIS_DOUBLE_RE.sub(r"\1", text)
        text = _EMPHASIS_SINGLE_RE.sub(r"\1", text)
    if settings.normalize_whitespace:
        text = _TRAILING_WS_RE.sub("\n", text)
        text = _MULTI_BLANK_RE.sub("\n\n", text)
    return text.strip("\n") + "\n"


# ---------------------------------------------------------------------------
# Sentence + paragraph segmentation
# ---------------------------------------------------------------------------

_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "e.g", "i.e",
    "prof", "rev", "fr", "gen", "col", "capt", "lt", "sgt", "no", "vol",
    "ave", "blvd", "rd", "mt", "fig", "inc",
}

_PARA_SPLIT_RE = re.compile(r"\n\s*\n+")
_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[“‘]?[A-Z0-9])")

_HEADING_PATTERNS = [
    re.compile(r"^\s*#{1,6}\s+\S"),                                # markdown
    re.compile(r"^\s*(chapter|prologue|epilogue|part|book)\b", re.IGNORECASE),
    re.compile(r"^\s*[IVXLCDM]+\s*[.:]?\s*$"),                     # roman numerals
]


def is_heading(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    for pat in _HEADING_PATTERNS:
        if pat.match(s):
            return True
    if len(s) < 60 and s == s.upper() and any(c.isalpha() for c in s) and not s.endswith((".", "!", "?")):
        return True
    return False


def split_paragraphs(text: str) -> List[str]:
    return [p.strip() for p in _PARA_SPLIT_RE.split(text) if p.strip()]


def split_sentences(paragraph: str) -> List[str]:
    """Best-effort sentence split with abbreviation guard."""
    paragraph = paragraph.strip()
    if not paragraph:
        return []
    if is_heading(paragraph):
        return [paragraph]
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


# ---------------------------------------------------------------------------
# Chunk-level data structures (pre-serialization, lighter than Chunk)
# ---------------------------------------------------------------------------

@dataclass
class _Sentence:
    text: str
    is_heading: bool
    paragraph_index: int
    paragraph_is_first_in_section: bool
    char_start: int  # offset within the source file (post-normalization)
    char_end: int


@dataclass
class _PackedChunk:
    sentences: List[_Sentence]
    starts_with_heading: bool
    ends_at_paragraph_boundary: bool
    ends_at_sentence_boundary: bool
    forced_sentence_split: bool

    @property
    def text(self) -> str:
        return _render_chunk_text(self.sentences)

    @property
    def char_count(self) -> int:
        return len(self.text)


def _render_chunk_text(sentences: Sequence[_Sentence]) -> str:
    """Reconstruct chunk text preserving paragraph breaks.

    Sentences within the same paragraph are joined by a single space; a new
    paragraph (different `paragraph_index`) introduces a blank line.
    """
    parts: List[str] = []
    current_para: Optional[int] = None
    for s in sentences:
        if current_para is None:
            parts.append(s.text)
        elif s.paragraph_index == current_para:
            parts.append(" " + s.text)
        else:
            parts.append("\n\n" + s.text)
        current_para = s.paragraph_index
    return "".join(parts).strip()


# ---------------------------------------------------------------------------
# Source ingestion + sentence stream
# ---------------------------------------------------------------------------

def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


_CHAPTER_FROM_NAME_RE = re.compile(
    r"chapter\s*0*(\d+(?:\.\d+)?)|^ch0*(\d+(?:\.\d+)?)|^chap0*(\d+(?:\.\d+)?)",
    re.IGNORECASE,
)


def detect_chapter_from_name(path: Path) -> Optional[str]:
    stem = path.stem
    m = _CHAPTER_FROM_NAME_RE.search(stem)
    if not m:
        return None
    num_str = next((g for g in m.groups() if g), None)
    if num_str is None:
        return None
    # Decimal suffix (e.g. "07.5" for interlude, "07.6" for Part divider) keeps
    # the file's source_file_id unique so chunks don't collide with the integer
    # chapter. "07.5" → "07_5" so the resulting source_file_id is "ch07_5".
    if "." in num_str:
        whole, dec = num_str.split(".", 1)
        return f"{int(whole):02d}_{dec}"
    return f"{int(num_str):02d}"


def build_sentence_stream(
    normalized_text: str,
) -> List[_Sentence]:
    """Walk paragraphs in order, emit sentence records with char offsets."""
    sentences: List[_Sentence] = []
    paragraphs = split_paragraphs(normalized_text)

    # Compute approximate paragraph offsets by re-finding each paragraph in
    # the normalized text in sequence. Good enough for source_start_char /
    # source_end_char reporting.
    cursor = 0
    prev_was_heading = False
    for p_idx, para in enumerate(paragraphs):
        idx = normalized_text.find(para, cursor)
        if idx < 0:
            idx = cursor  # fallback: be approximate rather than crash
        para_start = idx
        cursor = idx + len(para)

        para_is_heading = is_heading(para)
        starts_section = para_is_heading or prev_was_heading

        sents = split_sentences(para)
        # Re-scan within paragraph to find each sentence's offset.
        local_cursor = para_start
        for s in sents:
            s_idx = normalized_text.find(s, local_cursor)
            if s_idx < 0:
                s_idx = local_cursor
            sentences.append(
                _Sentence(
                    text=s,
                    is_heading=is_heading(s),
                    paragraph_index=p_idx,
                    paragraph_is_first_in_section=starts_section,
                    char_start=s_idx,
                    char_end=s_idx + len(s),
                )
            )
            local_cursor = s_idx + len(s)
            starts_section = False
        prev_was_heading = para_is_heading
    return sentences


# ---------------------------------------------------------------------------
# Packing logic
# ---------------------------------------------------------------------------

_CLAUSE_BOUNDARY_RE = re.compile(r"[;:\-—]\s+|,\s+")


def _force_split_long_sentence(
    sentence: _Sentence,
    hard_max: int,
) -> Tuple[List[_Sentence], bool]:
    """Split a sentence that alone exceeds `hard_max` at the safest clause
    boundary. Returns (parts, forced_flag)."""
    text = sentence.text
    if len(text) <= hard_max:
        return [sentence], False

    pieces: List[str] = []
    remaining = text
    base_offset = sentence.char_start
    while len(remaining) > hard_max:
        cut_at = -1
        # Prefer strong clause boundaries first.
        for pat in (r";\s+", r":\s+", r"\s—\s|\s-\s", r",\s+"):
            for m in re.finditer(pat, remaining[:hard_max]):
                cut_at = m.end()
        if cut_at < 0:
            # Last resort: hard cut at the nearest space before hard_max.
            cut_at = remaining.rfind(" ", 0, hard_max)
            if cut_at < 0:
                cut_at = hard_max
        pieces.append(remaining[:cut_at].rstrip())
        remaining = remaining[cut_at:].lstrip()
    if remaining:
        pieces.append(remaining)

    parts: List[_Sentence] = []
    running = base_offset
    for p in pieces:
        parts.append(
            _Sentence(
                text=p,
                is_heading=False,
                paragraph_index=sentence.paragraph_index,
                paragraph_is_first_in_section=False,
                char_start=running,
                char_end=running + len(p),
            )
        )
        running += len(p) + 1  # +1 for the separator we removed
    return parts, True


def pack_chunks(
    sentences: List[_Sentence],
    settings: Settings,
    warnings: List[Warning],
    source_file_id: str,
) -> List[_PackedChunk]:
    """Greedy packer honoring the boundary preference cascade.

    Walks the sentence stream, accumulating into `buf`. Closes the chunk when
    the next sentence would push past `target_max_chars` AND we have enough
    in the buffer, preferring stronger boundaries.
    """
    min_c = settings.target_min_chars
    max_c = settings.target_max_chars
    hard_c = settings.hard_max_chars

    out: List[_PackedChunk] = []
    buf: List[_Sentence] = []
    forced_in_buf = False

    def buf_len() -> int:
        return len(_render_chunk_text(buf)) if buf else 0

    def close_chunk(reason_paragraph_end: bool, reason_sentence_end: bool) -> None:
        nonlocal buf, forced_in_buf
        if not buf:
            return
        out.append(
            _PackedChunk(
                sentences=buf,
                starts_with_heading=buf[0].is_heading,
                ends_at_paragraph_boundary=reason_paragraph_end,
                ends_at_sentence_boundary=reason_sentence_end,
                forced_sentence_split=forced_in_buf,
            )
        )
        buf = []
        forced_in_buf = False

    i = 0
    while i < len(sentences):
        sent = sentences[i]

        # If a single sentence exceeds hard_max, force-split it first.
        if len(sent.text) > hard_c:
            warnings.append(
                Warning(
                    code="sentence_exceeds_hard_max",
                    message=f"Sentence of {len(sent.text)} chars exceeds hard_max={hard_c}; force-splitting at clause boundary.",
                    source_file_id=source_file_id,
                    severity="warning",
                )
            )
            parts, forced = _force_split_long_sentence(sent, hard_c)
            # Replace this sentence with its parts.
            sentences[i : i + 1] = parts
            if forced:
                forced_in_buf = True
            continue  # re-loop with the first part

        # Section boundary detection: this sentence is the first sentence
        # of a new section if its paragraph is flagged as starting a section
        # and we have something buffered.
        starts_section = sent.paragraph_is_first_in_section
        same_paragraph_as_prev = buf and sent.paragraph_index == buf[-1].paragraph_index

        prospective = buf_len() + (1 if same_paragraph_as_prev else 2) + len(sent.text)

        # Boundary cascade — try to close BEFORE adding `sent`.
        if buf:
            # 1) Section break: close if we have at least 70% of min.
            if starts_section and buf_len() >= int(min_c * 0.7):
                close_chunk(reason_paragraph_end=True, reason_sentence_end=True)
                continue
            # 2) Paragraph break: previous sentence ended its paragraph.
            entering_new_para = not same_paragraph_as_prev
            if entering_new_para and buf_len() >= min_c:
                # Either we'd overshoot max_c by adding, or we're already
                # comfortably past mid-target.
                if prospective > max_c or buf_len() >= max_c - 100:
                    close_chunk(reason_paragraph_end=True, reason_sentence_end=True)
                    continue
            # 3) Sentence break: adding this sentence would push past max_c.
            if prospective > max_c and buf_len() >= min_c:
                close_chunk(reason_paragraph_end=not same_paragraph_as_prev,
                            reason_sentence_end=True)
                continue
            # 3b) Adding this sentence would push past hard_max — close, no choice.
            if prospective > hard_c:
                close_chunk(reason_paragraph_end=not same_paragraph_as_prev,
                            reason_sentence_end=True)
                continue

        buf.append(sent)
        i += 1

    if buf:
        out.append(
            _PackedChunk(
                sentences=buf,
                starts_with_heading=buf[0].is_heading,
                ends_at_paragraph_boundary=True,
                ends_at_sentence_boundary=True,
                forced_sentence_split=forced_in_buf,
            )
        )

    _rebalance_tail(out, settings, warnings, source_file_id)
    return out


def _rebalance_tail(
    chunks: List[_PackedChunk],
    settings: Settings,
    warnings: List[Warning],
    source_file_id: str,
) -> None:
    """If the final chunk is much smaller than min_chars and the previous chunk
    has slack, peel sentences forward until the small chunk passes the floor or
    no more sentences can be moved without dropping the donor below min."""
    if len(chunks) < 2:
        return
    floor = int(settings.target_min_chars * 0.6)
    last = chunks[-1]
    prev = chunks[-2]
    if last.char_count >= floor:
        return

    moved = 0
    while last.char_count < settings.target_min_chars and len(prev.sentences) > 1:
        candidate = prev.sentences[-1]
        new_prev_chars = len(_render_chunk_text(prev.sentences[:-1]))
        new_last_chars = len(_render_chunk_text([candidate] + last.sentences))
        # Don't make the donor too small.
        if new_prev_chars < settings.target_min_chars:
            break
        # Don't make the receiver too big.
        if new_last_chars > settings.target_max_chars:
            break
        prev.sentences = prev.sentences[:-1]
        last.sentences = [candidate] + last.sentences
        moved += 1

    if moved:
        warnings.append(
            Warning(
                code="tail_rebalanced",
                message=f"Moved {moved} sentence(s) into trailing chunk to bring it above min_chars.",
                source_file_id=source_file_id,
                severity="info",
            )
        )

    if last.char_count < floor:
        warnings.append(
            Warning(
                code="trailing_chunk_short",
                message=f"Trailing chunk is {last.char_count} chars (< {floor}); could not rebalance further.",
                source_file_id=source_file_id,
                severity="warning",
            )
        )


# ---------------------------------------------------------------------------
# Chunk → manifest assembly
# ---------------------------------------------------------------------------

def _chunk_id(source_id: str, sequence_in_source: int) -> str:
    return f"{source_id}_{sequence_in_source:04d}"


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def _paragraph_count(sentences: Sequence[_Sentence]) -> int:
    return len({s.paragraph_index for s in sentences})


def assemble_chunks(
    packed: List[_PackedChunk],
    source: SourceFile,
    starting_global_seq: int,
    chunk_text_dir: Optional[Path],
) -> List[Chunk]:
    chunks: List[Chunk] = []
    for local_i, p in enumerate(packed, start=1):
        text = p.text
        # Use the already-segmented sentence list from the packer rather than
        # re-running split_sentences on the multi-paragraph chunk text — the
        # heading regex would otherwise swallow the whole chunk as one piece.
        first_sent = p.sentences[0].text if p.sentences else ""
        last_sent = p.sentences[-1].text if p.sentences else ""
        cid = _chunk_id(source.source_file_id, local_i)

        chunk_text_file = None
        if chunk_text_dir is not None:
            chunk_text_file = str(chunk_text_dir / f"{cid}.txt")

        src_start = p.sentences[0].char_start if p.sentences else 0
        src_end = p.sentences[-1].char_end if p.sentences else 0

        chunks.append(
            Chunk(
                chunk_id=cid,
                sequence_global=starting_global_seq + local_i - 1,
                sequence_in_source=local_i,
                source_file_id=source.source_file_id,
                source_file=source.path,
                chunk_text_file=chunk_text_file,
                text=text,
                character_count=len(text),
                word_count=_word_count(text),
                paragraph_count=_paragraph_count(p.sentences),
                sentence_count=len(p.sentences),
                starts_with_heading=p.starts_with_heading,
                ends_at_sentence_boundary=p.ends_at_sentence_boundary,
                ends_at_paragraph_boundary=p.ends_at_paragraph_boundary,
                forced_sentence_split=p.forced_sentence_split,
                source_start_char=src_start,
                source_end_char=src_end,
                text_hash=_sha256(text),
                context=ChunkContext(first_sentence=first_sent, last_sentence=last_sent),
            )
        )
    return chunks


def link_chunk_context(chunks: List[Chunk]) -> None:
    for i, c in enumerate(chunks):
        if i > 0:
            prev = chunks[i - 1]
            c.context.previous_chunk_id = prev.chunk_id
            c.context.previous_context = prev.context.last_sentence
        if i + 1 < len(chunks):
            nxt = chunks[i + 1]
            c.context.next_chunk_id = nxt.chunk_id
            c.context.next_context = nxt.context.first_sentence


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Pronunciation guide loading and substitution
# ---------------------------------------------------------------------------

PRONUNCIATION_GUIDE_GLOBS = [
    "narrator-pronunciation-guide.md",
    "pronunciation-guide.md",
    "pronunciation.md",
    "reviews/*narrator-pronunciation-guide*.md",
    "reviews/*pronunciation*.md",
    "world/voice-bible/pronunciation*.md",
    "world/voice-bible/narrator-pronunciation-guide.md",
]


def discover_pronunciation_guide(input_path: Path, max_hops: int = 5) -> Optional[Path]:
    """Walk up from input_path looking for a pronunciation guide in conventional locations."""
    start = input_path.resolve()
    if start.is_file():
        start = start.parent
    current = start
    for _ in range(max_hops + 1):
        for pattern in PRONUNCIATION_GUIDE_GLOBS:
            if any(ch in pattern for ch in "*?["):
                matches = sorted(current.glob(pattern), reverse=True)
                if matches:
                    return matches[0]
            else:
                candidate = current / pattern
                if candidate.is_file():
                    return candidate
        if current.parent == current:
            break
        current = current.parent
    return None


def _parse_md_row(row: str) -> List[str]:
    trimmed = row.strip()
    if trimmed.startswith("|"):
        trimmed = trimmed[1:]
    if trimmed.endswith("|"):
        trimmed = trimmed[:-1]
    return [cell.replace(r"\|", "|") for cell in re.split(r"(?<!\\)\|", trimmed)]


def load_pronunciation_guide(
    path: Path,
    warnings: List[Warning],
) -> List[PronunciationRule]:
    """Parse a markdown pronunciation guide.

    Recognizes any pipe-delimited markdown table whose header row contains both
    'original' and 'replacement' columns (case-insensitive). A 'notes' column is
    optional. Empty rows and rows whose original or replacement cell is empty
    are skipped. Duplicate originals keep the first occurrence and warn.
    """
    if not path.is_file():
        raise FileNotFoundError(f"Pronunciation guide not found: {path}")

    text = path.read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    rules: List[PronunciationRule] = []
    seen_originals: dict = {}

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line.startswith("|"):
            i += 1
            continue
        header_cells = _parse_md_row(line)
        lowered = [c.strip().lower() for c in header_cells]
        if "original" not in lowered or "replacement" not in lowered:
            i += 1
            continue
        if i + 1 >= len(lines) or not re.match(r"^\|?[\s:|-]+\|?\s*$", lines[i + 1].strip()):
            i += 1
            continue

        original_idx = lowered.index("original")
        replacement_idx = lowered.index("replacement")
        notes_idx = lowered.index("notes") if "notes" in lowered else None

        i += 2
        while i < len(lines):
            row = lines[i].strip()
            if not row.startswith("|"):
                break
            cells = _parse_md_row(row)
            if len(cells) <= max(original_idx, replacement_idx):
                i += 1
                continue
            original = cells[original_idx].strip()
            replacement = cells[replacement_idx].strip()
            notes = cells[notes_idx].strip() if notes_idx is not None and notes_idx < len(cells) else ""

            if not original or not replacement:
                i += 1
                continue
            if original.startswith("#") or original.startswith("<!--"):
                i += 1
                continue
            if original in seen_originals:
                warnings.append(
                    Warning(
                        code="duplicate_pronunciation_rule",
                        message=(
                            f"Duplicate pronunciation rule '{original}'; first occurrence kept "
                            f"(first at line {seen_originals[original]}, duplicate at line {i + 1})."
                        ),
                        severity="warning",
                    )
                )
                i += 1
                continue
            seen_originals[original] = i + 1
            rules.append(
                PronunciationRule(
                    original=original,
                    replacement=replacement,
                    notes=notes,
                    source_line=i + 1,
                )
            )
            i += 1

    return rules


def apply_pronunciation_substitutions(
    text: str,
    rules: List[PronunciationRule],
    source_file_id: str,
) -> Tuple[str, List[AppliedSubstitution]]:
    """Apply rules to text in declaration order.

    Substitutions are literal and case-sensitive. Word-like originals (purely
    alphanumeric, apostrophe, or hyphen) are matched with word boundaries so
    partial-word matches inside larger tokens are not replaced. A trailing
    possessive ('s or ’s) is carried through automatically — "Dossi's" becomes
    "DAH-si's" — so possessive forms need no separate rule. Otherwise the
    literal phrase is matched as-is.
    """
    applied: List[AppliedSubstitution] = []
    working = text

    for rule in rules:
        if re.fullmatch(r"[\w’'\-]+", rule.original):
            # Match the manuscript-cased original OR its ALL-CAPS form, so a name
            # that appears in an uppercase heading (e.g. "17. DOSSI FINDS HIM")
            # is substituted too. Without this, the case-sensitive match leaks the
            # literal name to TTS in headings (spoken "Dossie"). The replacement is
            # upper-cased to match, so the respelling (DAH-SEE) is still spoken right.
            pattern = re.compile(
                rf"(?<![\w’'\-])(?P<name>{re.escape(rule.original)}|{re.escape(rule.original.upper())})"
                rf"(?P<poss>[’']s)?(?![\w’'\-])"
            )
        else:
            pattern = re.compile(re.escape(rule.original))

        count = 0

        def _replace(match: "re.Match[str]") -> str:
            nonlocal count
            count += 1
            matched = match.groupdict().get("name")
            # An all-caps heading match gets the upper-cased respelling.
            repl = rule.replacement
            if matched is not None and matched.isupper() and not rule.original.isupper():
                repl = rule.replacement.upper()
            return repl + (match.groupdict().get("poss") or "")

        working = pattern.sub(_replace, working)
        if count > 0:
            applied.append(
                AppliedSubstitution(
                    original=rule.original,
                    replacement=rule.replacement,
                    count=count,
                    source_file_id=source_file_id,
                )
            )

    return working, applied


def discover_inputs(input_path: Path) -> List[Path]:
    if input_path.is_file():
        if input_path.suffix.lower() != ".txt":
            raise SystemExit(f"--input file must be .txt: {input_path}")
        return [input_path]
    if input_path.is_dir():
        files = sorted(p for p in input_path.iterdir() if p.is_file() and p.suffix.lower() == ".txt")
        if not files:
            raise SystemExit(f"No .txt files found in {input_path}")
        return files
    raise SystemExit(f"--input not found: {input_path}")


def _source_id_for(path: Path, index_among_files: int) -> Tuple[str, Optional[str]]:
    chap = detect_chapter_from_name(path)
    if chap is not None:
        return f"ch{chap}", chap
    return f"file{index_among_files + 1:03d}", None


# ---------------------------------------------------------------------------
# Incremental re-chunk: diff a chapter against its prior chunks, reuse the
# unchanged ones (text + generated audio + downstream state) and only mark the
# touched chunks for regeneration. Falls back to a full re-chunk when an edit
# churns more of the chapter than `rechunk_threshold`.
# ---------------------------------------------------------------------------

# A leftover chunk-id suffix matcher so we glob a source's audio precisely:
# "ch00_0001" but NOT "ch00_5_0001" when the source id is "ch00".
def _chunk_audio_glob(source_file_id: str, ext: str) -> str:
    return f"{source_file_id}_[0-9][0-9][0-9][0-9]{ext}"


def _sentences_of_text(text: str) -> List[str]:
    """Recover the sentence-text sequence from a stored chunk's rendered text,
    matching how the packer originally segmented it (paragraphs -> sentences)."""
    out: List[str] = []
    for para in split_paragraphs(text):
        out.extend(split_sentences(para))
    return out


def _load_prior_manifest(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — a corrupt prior manifest just disables reuse
        return None


def _prior_chunks_by_source(prior: Optional[dict]) -> dict:
    out: dict = {}
    if not prior:
        return out
    for c in prior.get("chunks") or []:
        if isinstance(c, dict) and c.get("source_file_id"):
            out.setdefault(c["source_file_id"], []).append(c)
    for sid in out:
        out[sid].sort(key=lambda c: int(c.get("sequence_in_source") or 0))
    return out


def _retarget_audio_path(path_str: Optional[str], old_id: str, new_id: str) -> Optional[str]:
    if not path_str:
        return path_str
    p = Path(path_str)
    return str(p.with_name(p.name.replace(old_id, new_id, 1)))


def _chunk_from_dict(d: dict) -> Chunk:
    """Rebuild a Chunk dataclass from a prior-manifest chunk dict, for verbatim
    pass-through of chapters outside an `--only` scope. The speechify/validation/
    repair blocks are kept as plain dicts (serialized as-is)."""
    ctx = d.get("context") or {}
    return Chunk(
        chunk_id=d["chunk_id"],
        sequence_global=d.get("sequence_global", 0),
        sequence_in_source=d.get("sequence_in_source", 0),
        source_file_id=d["source_file_id"],
        source_file=d.get("source_file", ""),
        chunk_text_file=d.get("chunk_text_file"),
        text=d.get("text", ""),
        character_count=d.get("character_count", len(d.get("text", ""))),
        word_count=d.get("word_count", 0),
        paragraph_count=d.get("paragraph_count", 0),
        sentence_count=d.get("sentence_count", 0),
        starts_with_heading=d.get("starts_with_heading", False),
        ends_at_sentence_boundary=d.get("ends_at_sentence_boundary", True),
        ends_at_paragraph_boundary=d.get("ends_at_paragraph_boundary", True),
        forced_sentence_split=d.get("forced_sentence_split", False),
        source_start_char=d.get("source_start_char", 0),
        source_end_char=d.get("source_end_char", 0),
        text_hash=d.get("text_hash", ""),
        context=ChunkContext(
            first_sentence=ctx.get("first_sentence", ""),
            last_sentence=ctx.get("last_sentence", ""),
            previous_chunk_id=ctx.get("previous_chunk_id"),
            next_chunk_id=ctx.get("next_chunk_id"),
            previous_context=ctx.get("previous_context", ""),
            next_context=ctx.get("next_context", ""),
        ),
        speechify=d.get("speechify") or {},
        validation=d.get("validation") or {},
        repair=d.get("repair") or {},
    )


def _source_from_dict(d: dict) -> SourceFile:
    return SourceFile(
        source_file_id=d["source_file_id"],
        path=d.get("path", ""),
        display_name=d.get("display_name", ""),
        detected_chapter=d.get("detected_chapter"),
        source_hash=d.get("source_hash", ""),
        character_count=d.get("character_count", 0),
        estimated_chunks=d.get("estimated_chunks", 0),
        pronunciation=d.get("pronunciation") or {},
    )


def plan_incremental_chunks(
    old_chunks: List[dict],
    new_sentences: List[_Sentence],
    settings: Settings,
    warnings: List[Warning],
    source_file_id: str,
    rechunk_threshold: float,
) -> Tuple[list, dict]:
    """Return (plan, stats).

    `plan` is a list of ("reuse", old_chunk_dict) | ("new", _PackedChunk). Whole
    old chunks are reused where an unchanged run of sentences covers them exactly
    and contiguously; everything else is collected into "gaps" that are re-packed
    by the normal greedy packer (so size limits / forced splits still apply).
    """
    old_chunk_sents = [_sentences_of_text(oc.get("text", "")) for oc in old_chunks]
    old_seq: List[str] = []
    unit_to_chunk: List[Tuple[int, int]] = []  # old unit index -> (chunk_idx, offset)
    for ci, sents in enumerate(old_chunk_sents):
        for off, st in enumerate(sents):
            old_seq.append(st)
            unit_to_chunk.append((ci, off))

    new_seq = [s.text for s in new_sentences]

    sm = difflib.SequenceMatcher(a=old_seq, b=new_seq, autojunk=False)
    new_to_old: dict = {}
    for i, j, n in sm.get_matching_blocks():
        for k in range(n):
            new_to_old[j + k] = i + k

    matched = len(new_to_old)
    changed_fraction = 1.0 - (matched / len(new_seq)) if new_seq else 1.0

    if not old_seq or changed_fraction > rechunk_threshold:
        return [], {
            "full_rechunk": True,
            "changed_fraction": round(changed_fraction, 3),
            "reused_chunks": 0,
        }

    plan: list = []
    gap: List[_Sentence] = []
    N = len(new_seq)

    def flush_gap() -> None:
        nonlocal gap
        if gap:
            for pc in pack_chunks(list(gap), settings, warnings, source_file_id):
                plan.append(("new", pc))
            gap = []

    ni = 0
    while ni < N:
        oi = new_to_old.get(ni)
        reused = False
        if oi is not None:
            ci, off = unit_to_chunk[oi]
            if off == 0:
                clen = len(old_chunk_sents[ci])
                if clen > 0 and all(new_to_old.get(ni + t) == oi + t for t in range(clen)):
                    flush_gap()
                    plan.append(("reuse", old_chunks[ci]))
                    ni += clen
                    reused = True
        if not reused:
            gap.append(new_sentences[ni])
            ni += 1
    flush_gap()

    # Safety net: any freshly-packed chunk whose final text is byte-identical to an
    # as-yet-unused old chunk can still reuse that old chunk's audio. This is exact
    # (hash-equal) so it never reuses wrong audio, and it recovers the cases the
    # sentence diff can't align — force-split sentences, heading blobs that span
    # several chunks, and boundaries that re-synced after a localized edit.
    used_old = {id(p) for k, p in plan if k == "reuse"}
    old_by_hash: dict = {}
    for oc in old_chunks:
        if id(oc) in used_old:
            continue
        old_by_hash.setdefault(oc.get("text_hash"), []).append(oc)
    for idx, (k, p) in enumerate(plan):
        if k != "new":
            continue
        bucket = old_by_hash.get(_sha256(p.text))
        if bucket:
            plan[idx] = ("reuse", bucket.pop(0))

    reused_n = sum(1 for k, _ in plan if k == "reuse")
    return plan, {
        "full_rechunk": False,
        "changed_fraction": round(changed_fraction, 3),
        "reused_chunks": reused_n,
    }


def assemble_incremental(
    plan: list,
    source: SourceFile,
    starting_global_seq: int,
    chunk_text_dir: Optional[Path],
) -> Tuple[List[Chunk], List[Tuple[str, str]]]:
    """Build Chunk records from an incremental plan. Returns (chunks, audio_moves)
    where audio_moves is (old_id, new_id) for reused chunks that need their audio
    renamed into the new sequential slot."""
    chunks: List[Chunk] = []
    audio_moves: List[Tuple[str, str]] = []
    for local_i, (kind, payload) in enumerate(plan, start=1):
        cid = _chunk_id(source.source_file_id, local_i)
        chunk_text_file = str(chunk_text_dir / f"{cid}.txt") if chunk_text_dir is not None else None

        if kind == "reuse":
            oc = payload
            old_id = oc["chunk_id"]
            text = oc.get("text", "")
            sents = _sentences_of_text(text)
            speechify = copy.deepcopy(oc.get("speechify") or {})
            validation = copy.deepcopy(oc.get("validation") or {})
            repair = copy.deepcopy(oc.get("repair") or {})
            if old_id != cid:
                audio_moves.append((old_id, cid))
                speechify["audio_file"] = _retarget_audio_path(speechify.get("audio_file"), old_id, cid)
                speechify["speech_marks_file"] = _retarget_audio_path(speechify.get("speech_marks_file"), old_id, cid)
            chunks.append(
                Chunk(
                    chunk_id=cid,
                    sequence_global=starting_global_seq + local_i - 1,
                    sequence_in_source=local_i,
                    source_file_id=source.source_file_id,
                    source_file=source.path,
                    chunk_text_file=chunk_text_file,
                    text=text,
                    character_count=len(text),
                    word_count=_word_count(text),
                    paragraph_count=len(split_paragraphs(text)),
                    sentence_count=len(sents),
                    starts_with_heading=bool(oc.get("starts_with_heading", False)),
                    ends_at_sentence_boundary=bool(oc.get("ends_at_sentence_boundary", True)),
                    ends_at_paragraph_boundary=bool(oc.get("ends_at_paragraph_boundary", True)),
                    forced_sentence_split=bool(oc.get("forced_sentence_split", False)),
                    source_start_char=int(oc.get("source_start_char", 0) or 0),
                    source_end_char=int(oc.get("source_end_char", 0) or 0),
                    text_hash=oc.get("text_hash") or _sha256(text),
                    context=ChunkContext(
                        first_sentence=sents[0] if sents else "",
                        last_sentence=sents[-1] if sents else "",
                    ),
                    speechify=speechify,
                    validation=validation,
                    repair=repair,
                )
            )
        else:
            pc: _PackedChunk = payload
            text = pc.text
            chunks.append(
                Chunk(
                    chunk_id=cid,
                    sequence_global=starting_global_seq + local_i - 1,
                    sequence_in_source=local_i,
                    source_file_id=source.source_file_id,
                    source_file=source.path,
                    chunk_text_file=chunk_text_file,
                    text=text,
                    character_count=len(text),
                    word_count=_word_count(text),
                    paragraph_count=_paragraph_count(pc.sentences),
                    sentence_count=len(pc.sentences),
                    starts_with_heading=pc.starts_with_heading,
                    ends_at_sentence_boundary=pc.ends_at_sentence_boundary,
                    ends_at_paragraph_boundary=pc.ends_at_paragraph_boundary,
                    forced_sentence_split=pc.forced_sentence_split,
                    source_start_char=pc.sentences[0].char_start if pc.sentences else 0,
                    source_end_char=pc.sentences[-1].char_end if pc.sentences else 0,
                    text_hash=_sha256(text),
                    context=ChunkContext(
                        first_sentence=pc.sentences[0].text if pc.sentences else "",
                        last_sentence=pc.sentences[-1].text if pc.sentences else "",
                    ),
                )
            )
    return chunks, audio_moves


def apply_audio_ops(
    audio_dir: Path,
    source_file_id: str,
    audio_moves: List[Tuple[str, str]],
    retained_old_ids: set,
    dry_run: bool,
) -> dict:
    """Rename reused chunks' audio into their new slots (collision-safe) and prune
    audio that is no longer referenced (retired chunks / stale regen slots).

    `audio_dir` is the chapter's per-chapter audio directory `<out>/_gen/<source_id>`
    (resolved by the caller via `_audio_dir_for`), the same layout the generator and
    repair-executor use — NOT a flat `audio/chunks/` dir.

    Returns a stats dict. Touches nothing when `dry_run` is True or there is no
    audio directory yet.
    """
    stats = {"renamed": 0, "pruned": 0, "missing_source_audio": 0}
    if not audio_dir.is_dir():
        return stats

    suffixes = (".mp3", ".speechmarks.json")
    move_map = {old: new for old, new in audio_moves}  # only id-changing reuses

    existing: List[Path] = []
    for ext in suffixes:
        existing.extend(audio_dir.glob(_chunk_audio_glob(source_file_id, ext)))

    # The set of old ids whose audio must be preserved (reused, regardless of
    # whether the id changed). retained_old_ids already encodes that.
    def id_of(p: Path) -> str:
        name = p.name
        for ext in suffixes:
            if name.endswith(ext):
                return name[: -len(ext)]
        return p.stem

    retired = [p for p in existing if id_of(p) not in retained_old_ids]

    # Unedited chapter: no id changes and nothing to prune -> leave audio alone.
    if not move_map and not retired:
        return stats

    if dry_run:
        for old, _new in move_map.items():
            for ext in suffixes:
                if (audio_dir / f"{old}{ext}").exists():
                    stats["renamed"] += 1
        stats["pruned"] = len(retired)
        return stats

    staging = audio_dir / f".incr_stage_{source_file_id}"
    if staging.exists():
        shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=True)

    # 1) Move every existing source audio file into staging, keyed by old id.
    staged: dict = {}  # old_id -> {ext: staged_path}
    for p in existing:
        oid = id_of(p)
        ext = p.name[len(oid):]
        dest = staging / p.name
        shutil.move(str(p), str(dest))
        staged.setdefault(oid, {})[ext] = dest

    # 2) Restore retained chunks into their NEW slots (rename when id changed).
    for old_id, files in staged.items():
        if old_id not in retained_old_ids:
            continue  # retired -> leave in staging -> pruned below
        new_id = move_map.get(old_id, old_id)
        for ext, staged_path in files.items():
            target = audio_dir / f"{new_id}{ext}"
            shutil.move(str(staged_path), str(target))
            if old_id != new_id:
                stats["renamed"] += 1

    # 3) Anything still in staging is retired/stale -> prune.
    leftover = list(staging.glob("*"))
    stats["pruned"] = len(leftover)
    shutil.rmtree(staging, ignore_errors=True)
    return stats


def _write_incremental_report(
    reports_dir: Path,
    rows: List[dict],
    audio_stats: dict,
    dry_run: bool,
    threshold: float,
) -> None:
    total_new = sum(r["new_chunks"] for r in rows)
    total_reused = sum(r["reused_chunks"] for r in rows)
    total_regen = total_new - total_reused
    payload = {
        "dry_run": dry_run,
        "rechunk_threshold": threshold,
        "totals": {
            "new_chunks": total_new,
            "reused_chunks": total_reused,
            "regen_chunks": total_regen,
            "audio_renamed": audio_stats.get("renamed", 0),
            "audio_pruned": audio_stats.get("pruned", 0),
        },
        "per_source": rows,
    }
    _write_json(reports_dir / "incremental_reuse_report.json", payload, pretty=True)

    lines: List[str] = []
    lines.append("# Incremental Re-chunk Reuse Report\n")
    if dry_run:
        lines.append("> **DRY RUN** — no manifest written, no audio moved.\n")
    lines.append(f"- Reuse threshold (full re-chunk above): **{threshold:.0%}** of a chapter changed")
    lines.append(f"- Total chunks: **{total_new}**")
    lines.append(f"- Reused (audio kept): **{total_reused}**")
    lines.append(f"- Regenerate (changed/new): **{total_regen}**")
    lines.append(f"- Audio files renamed: **{audio_stats.get('renamed', 0)}**")
    lines.append(f"- Audio files pruned: **{audio_stats.get('pruned', 0)}**\n")
    lines.append("| Chapter | Mode | New | Reused | Regen | % changed |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for r in rows:
        cf = r.get("changed_fraction")
        cf_str = f"{cf:.0%}" if isinstance(cf, (int, float)) else "—"
        lines.append(
            f"| `{r['source_file_id']}` | {r['mode']} | {r['new_chunks']} | "
            f"{r['reused_chunks']} | {r['regen_chunks']} | {cf_str} |"
        )
    lines.append("")
    (reports_dir / "incremental_reuse_report.md").write_text("\n".join(lines), encoding="utf-8")


def _log_incremental(rows: List[dict], audio_stats: dict, dry_run: bool) -> None:
    total_new = sum(r["new_chunks"] for r in rows)
    total_reused = sum(r["reused_chunks"] for r in rows)
    touched = [r for r in rows if r["regen_chunks"] > 0]
    logger.info(
        "Incremental%s: %d/%d chunk(s) reused, %d to regenerate across %d touched chapter(s); "
        "audio renamed=%d pruned=%d.",
        " [DRY RUN]" if dry_run else "",
        total_reused, total_new, total_new - total_reused, len(touched),
        audio_stats.get("renamed", 0), audio_stats.get("pruned", 0),
    )


def build_manifest(args: argparse.Namespace) -> Tuple[Manifest, List[Warning], List[AppliedSubstitution]]:
    settings = Settings(
        target_min_chars=args.min_chars,
        target_max_chars=args.max_chars,
        hard_max_chars=args.hard_max,
        normalize_quotes=args.normalize_quotes,
        normalize_whitespace=not args.no_normalize_whitespace,
        strip_markdown=not args.no_strip_markdown,
    )

    inputs = discover_inputs(args.input)
    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir = out_dir / "chunks" if args.write_txt_chunks else None
    if chunks_dir is not None:
        chunks_dir.mkdir(parents=True, exist_ok=True)
    reports_dir = out_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    warnings: List[Warning] = []
    source_records: List[SourceFile] = []
    all_chunks: List[Chunk] = []
    all_applied: List[AppliedSubstitution] = []
    global_seq = 1

    # Resolve pronunciation guide. --pronunciation-guide wins; auto-discover otherwise;
    # --no-pronunciation-guide disables entirely.
    pronunciation_rules: List[PronunciationRule] = []
    pronunciation_guide_path: Optional[Path] = None
    if not getattr(args, "no_pronunciation_guide", False):
        if getattr(args, "pronunciation_guide", None):
            pronunciation_guide_path = Path(args.pronunciation_guide)
        else:
            pronunciation_guide_path = discover_pronunciation_guide(args.input)

        if pronunciation_guide_path:
            try:
                pronunciation_rules = load_pronunciation_guide(pronunciation_guide_path, warnings)
                logger.info(
                    "Pronunciation guide: %s (%d rule(s) loaded).",
                    pronunciation_guide_path, len(pronunciation_rules),
                )
            except FileNotFoundError:
                if getattr(args, "pronunciation_guide", None):
                    raise
                pronunciation_guide_path = None
        elif getattr(args, "pronunciation_guide", None):
            raise SystemExit(f"Pronunciation guide not found: {args.pronunciation_guide}")

    settings.pronunciation_guide_path = str(pronunciation_guide_path) if pronunciation_guide_path else None
    settings.pronunciation_guide_loaded = bool(pronunciation_rules)
    settings.pronunciation_rules_loaded = len(pronunciation_rules)

    # Incremental mode: when a prior manifest exists (and --full wasn't passed),
    # diff each chapter against its prior chunks and reuse the unchanged ones —
    # text, generated audio, and downstream speechify/validation/repair state —
    # regenerating only the chunks the edit actually touched.
    prior_manifest = None if getattr(args, "full", False) else _load_prior_manifest(out_dir / "chunk_manifest.json")
    prior_by_source = _prior_chunks_by_source(prior_manifest)
    incremental = bool(prior_by_source)
    # Audio chunks live per-chapter under <out_dir>/_gen/<source_id> (e.g.
    # book-1-simba-3.0/_gen/ch00/ch00_0001.mp3) — the same structure the generator
    # (model_test_generate.py --out-dir _gen) and the repair-executor use. Text
    # chunks stay flat in <out_dir>/chunks. Resolved per chapter at the apply step
    # below; the chunker's incremental audio management (rename/prune) reads/writes there.
    def _audio_dir_for(sid: str) -> Path:
        return out_dir / "_gen" / sid
    dry_run = bool(getattr(args, "dry_run", False))
    rechunk_threshold = float(getattr(args, "rechunk_threshold", 0.5))
    incr_audio_jobs: List[Tuple[str, List[Tuple[str, str]], set]] = []
    incr_report_rows: List[dict] = []
    seen_source_ids: set = set()
    if incremental:
        logger.info(
            "Incremental mode: diffing against prior manifest (%d chapter(s) known).%s",
            len(prior_by_source), " [DRY RUN]" if dry_run else "",
        )

    # --only: restrict re-chunking to specific source IDs (e.g. "ch00"). Every
    # other chapter in the prior manifest passes through verbatim — its chunks and
    # audio are left exactly as they are. This scopes an edit to one chapter even
    # when an unrelated global change (e.g. a pronunciation-guide tweak) would
    # otherwise touch others.
    scope: Optional[set] = None
    if getattr(args, "only", None):
        scope = {x.strip() for x in args.only.split(",") if x.strip()}
        if not incremental:
            raise SystemExit(
                "--only requires an existing chunk_manifest.json in --out to pass "
                "the other chapters through. None found (or --full was passed)."
            )
        logger.info("Scope: re-chunking only %s; all other chapters pass through unchanged.",
                    ", ".join(sorted(scope)))
    prior_source_records = {sf["source_file_id"]: sf for sf in (prior_manifest or {}).get("source_files", [])}
    passthrough_ids: set = set()

    for idx, path in enumerate(inputs):
        source_id, detected_chap = _source_id_for(path, idx)

        # Out-of-scope chapter: pass its prior chunks + source record through
        # verbatim (no diff, no audio change at all).
        if scope is not None and source_id not in scope:
            prior_chunks = prior_by_source.get(source_id)
            if prior_chunks:
                passthrough_ids.add(source_id)
                if source_id in prior_source_records:
                    source_records.append(_source_from_dict(prior_source_records[source_id]))
                all_chunks.extend(_chunk_from_dict(d) for d in prior_chunks)
            else:
                warnings.append(Warning(
                    code="scope_skip_no_prior",
                    message=f"{source_id} is outside --only scope and absent from the prior "
                            f"manifest; skipped (not added to the new manifest).",
                    source_file_id=source_id, severity="warning"))
            continue

        try:
            raw = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            warnings.append(
                Warning(
                    code="non_utf8_input",
                    message=f"{path}: not UTF-8, retrying with latin-1.",
                    severity="warning",
                )
            )
            raw = path.read_text(encoding="latin-1")

        normalized = normalize_source(raw, settings)

        original_hash = _sha256(normalized)
        original_length = len(normalized)

        applied_for_source: List[AppliedSubstitution] = []
        if pronunciation_rules:
            normalized, applied_for_source = apply_pronunciation_substitutions(
                normalized, pronunciation_rules, source_id
            )
            all_applied.extend(applied_for_source)

        sf = SourceFile(
            source_file_id=source_id,
            path=str(path),
            display_name=path.stem,
            detected_chapter=detected_chap,
            source_hash=_sha256(normalized),
            character_count=len(normalized),
            estimated_chunks=max(1, len(normalized) // settings.target_max_chars + 1),
            pronunciation={
                "rules_loaded": len(pronunciation_rules),
                "rules_applied": len(applied_for_source),
                "substitutions_total_count": sum(a.count for a in applied_for_source),
                "original_source_hash": original_hash,
                "original_character_count": original_length,
                "post_substitution_character_count": len(normalized),
                "applied": [
                    {"original": a.original, "replacement": a.replacement, "count": a.count}
                    for a in applied_for_source
                ],
            },
        )
        source_records.append(sf)

        sentences = build_sentence_stream(normalized)
        if not sentences:
            warnings.append(
                Warning(
                    code="empty_after_normalization",
                    message=f"{path} produced no sentences after normalization; skipping.",
                    source_file_id=source_id,
                    severity="error",
                )
            )
            continue

        seen_source_ids.add(source_id)
        old_chunks = prior_by_source.get(source_id) if incremental else None

        if old_chunks:
            plan, incr_stats = plan_incremental_chunks(
                old_chunks, sentences, settings, warnings, source_id, rechunk_threshold
            )
        else:
            plan, incr_stats = [], {"reused_chunks": 0, "changed_fraction": None}

        if plan:
            # Diff-driven reuse: unchanged chunks carried over, gaps re-packed.
            chunks, audio_moves = assemble_incremental(plan, sf, global_seq, chunks_dir)
            retained_old_ids = {p["chunk_id"] for kind, p in plan if kind == "reuse"}
            if incremental:
                incr_audio_jobs.append((source_id, audio_moves, retained_old_ids))
            mode = "incremental"
        else:
            packed = pack_chunks(sentences, settings, warnings, source_id)
            if not packed:
                warnings.append(
                    Warning(
                        code="empty_packing",
                        message=f"Packing produced no chunks for {path}.",
                        source_file_id=source_id,
                        severity="error",
                    )
                )
                continue
            chunks = assemble_chunks(
                packed,
                sf,
                starting_global_seq=global_seq,
                chunk_text_dir=chunks_dir,
            )
            if incremental and old_chunks:
                # Full re-chunk fallback for an existing chapter (too much churned):
                # prune all its prior audio so every chunk regenerates cleanly.
                incr_audio_jobs.append((source_id, [], set()))
            mode = "full_rechunk" if old_chunks else ("new_source" if incremental else "full")

        if incremental:
            reused = incr_stats.get("reused_chunks", 0)
            incr_report_rows.append({
                "source_file_id": source_id,
                "new_chunks": len(chunks),
                "reused_chunks": reused,
                "regen_chunks": len(chunks) - reused,
                "changed_fraction": incr_stats.get("changed_fraction"),
                "mode": mode,
            })

        global_seq += len(chunks)
        all_chunks.extend(chunks)

    # Re-number global sequence across the final (possibly mixed reused +
    # passed-through) chunk list so it stays monotonic and contiguous.
    for i, c in enumerate(all_chunks, start=1):
        c.sequence_global = i

    link_chunk_context(all_chunks)

    # Incremental side-effects: rename reused chunks' audio into their new slots,
    # prune retired/stale audio, and emit a per-chapter reuse report.
    if incremental:
        for sid in prior_by_source:
            # Prune a chapter's audio only if it was in scope (or no scope) and is
            # now gone. Passed-through (out-of-scope) chapters are never touched.
            if sid in seen_source_ids or sid in passthrough_ids:
                continue
            if scope is not None and sid not in scope:
                continue
            incr_audio_jobs.append((sid, [], set()))  # in-scope chapter removed -> prune all
        audio_stats = {"renamed": 0, "pruned": 0}
        for sid, moves, retained in incr_audio_jobs:
            st = apply_audio_ops(_audio_dir_for(sid), sid, moves, retained, dry_run)
            audio_stats["renamed"] += st["renamed"]
            audio_stats["pruned"] += st["pruned"]
        if chunks_dir is not None and not dry_run:
            new_ids = {c.chunk_id for c in all_chunks}
            for txt in chunks_dir.glob("*.txt"):
                if txt.stem not in new_ids:
                    txt.unlink(missing_ok=True)
        _write_incremental_report(reports_dir, incr_report_rows, audio_stats, dry_run, rechunk_threshold)
        _log_incremental(incr_report_rows, audio_stats, dry_run)

    # Per-chunk size warnings
    for c in all_chunks:
        if c.character_count > settings.hard_max_chars:
            warnings.append(
                Warning(
                    code="chunk_over_hard_max",
                    message=f"Chunk {c.chunk_id} is {c.character_count} chars (> hard_max={settings.hard_max_chars}).",
                    chunk_id=c.chunk_id,
                    source_file_id=c.source_file_id,
                    severity="error",
                )
            )
        elif c.character_count > settings.target_max_chars:
            warnings.append(
                Warning(
                    code="chunk_over_target",
                    message=f"Chunk {c.chunk_id} is {c.character_count} chars (> target_max={settings.target_max_chars}).",
                    chunk_id=c.chunk_id,
                    source_file_id=c.source_file_id,
                    severity="info",
                )
            )
        if c.character_count < settings.target_min_chars and c is not all_chunks[-1]:
            warnings.append(
                Warning(
                    code="chunk_under_target",
                    message=f"Chunk {c.chunk_id} is {c.character_count} chars (< target_min={settings.target_min_chars}).",
                    chunk_id=c.chunk_id,
                    source_file_id=c.source_file_id,
                    severity="info",
                )
            )

    summary = _summarize(all_chunks, settings, warnings, len(source_records))
    summary.pronunciation_rules_loaded = len(pronunciation_rules)
    summary.pronunciation_distinct_terms_applied = len({a.original for a in all_applied})
    summary.pronunciation_substitutions_total = sum(a.count for a in all_applied)

    manifest = Manifest(
        project="audiobook_text_prep",
        created_at=datetime.now(timezone.utc).isoformat(),
        settings=settings,
        source_files=source_records,
        chunks=all_chunks,
        summary=summary,
    )
    return manifest, warnings, all_applied


def _summarize(
    chunks: List[Chunk],
    settings: Settings,
    warnings: List[Warning],
    source_count: int,
) -> Summary:
    s = Summary()
    s.source_file_count = source_count
    s.chunk_count = len(chunks)
    if not chunks:
        s.warnings_count = len(warnings)
        return s
    sizes = [c.character_count for c in chunks]
    s.total_characters = sum(sizes)
    s.average_chunk_characters = s.total_characters // len(chunks)
    s.min_chunk_characters = min(sizes)
    s.max_chunk_characters = max(sizes)
    s.chunks_over_target = sum(1 for c in chunks if c.character_count > settings.target_max_chars)
    s.chunks_under_target = sum(1 for c in chunks if c.character_count < settings.target_min_chars)
    s.chunks_over_hard_max = sum(1 for c in chunks if c.character_count > settings.hard_max_chars)
    s.sentence_splits_forced = sum(1 for c in chunks if c.forced_sentence_split)
    s.warnings_count = len(warnings)
    return s


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def _write_json(path: Path, payload: dict, *, pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    else:
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def write_outputs(
    manifest: Manifest,
    warnings: List[Warning],
    out_dir: Path,
    write_txt_chunks: bool,
    applied_substitutions: Optional[List[AppliedSubstitution]] = None,
) -> None:
    payload = asdict(manifest)
    _write_json(out_dir / "chunk_manifest.json", payload, pretty=False)
    _write_json(out_dir / "chunk_manifest.pretty.json", payload, pretty=True)

    if write_txt_chunks:
        chunks_dir = out_dir / "chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)
        for c in manifest.chunks:
            (chunks_dir / f"{c.chunk_id}.txt").write_text(c.text + "\n", encoding="utf-8")

    reports_dir = out_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    _write_json(
        reports_dir / "chunking_warnings.json",
        {"warnings": [asdict(w) for w in warnings]},
        pretty=True,
    )
    _write_summary_md(reports_dir / "chunking_summary.md", manifest, warnings, out_dir)

    applied = applied_substitutions or []
    if manifest.settings.pronunciation_guide_loaded or applied:
        per_source = {sf.source_file_id: sf.pronunciation for sf in manifest.source_files}
        _write_json(
            reports_dir / "pronunciation_substitutions.json",
            {
                "created_at": manifest.created_at,
                "guide_path": manifest.settings.pronunciation_guide_path,
                "rules_loaded": manifest.settings.pronunciation_rules_loaded,
                "distinct_terms_applied": manifest.summary.pronunciation_distinct_terms_applied,
                "substitutions_total_count": manifest.summary.pronunciation_substitutions_total,
                "applied_per_source": per_source,
            },
            pretty=True,
        )


def _write_summary_md(
    path: Path,
    manifest: Manifest,
    warnings: List[Warning],
    out_dir: Path,
) -> None:
    s = manifest.summary
    lines: List[str] = []
    lines.append("# Audiobook Chunking Summary\n")
    lines.append(f"_Generated: {manifest.created_at}_\n")

    lines.append("## Files processed\n")
    if manifest.source_files:
        lines.append("| ID | File | Chapter | Chars | Est. chunks |")
        lines.append("| --- | --- | --- | --- | --- |")
        for sf in manifest.source_files:
            lines.append(
                f"| `{sf.source_file_id}` | `{sf.path}` | "
                f"{sf.detected_chapter or '—'} | {sf.character_count} | {sf.estimated_chunks} |"
            )
        lines.append("")
    else:
        lines.append("_No source files._\n")

    lines.append("## Chunk totals\n")
    lines.append(f"- Source files: **{s.source_file_count}**")
    lines.append(f"- Total chunks: **{s.chunk_count}**")
    lines.append(f"- Total characters: **{s.total_characters}**")
    lines.append(f"- Average chunk size: **{s.average_chunk_characters}** chars")
    lines.append(f"- Smallest chunk: **{s.min_chunk_characters}** chars")
    lines.append(f"- Largest chunk: **{s.max_chunk_characters}** chars")
    lines.append(f"- Chunks under `{manifest.settings.target_min_chars}` chars: **{s.chunks_under_target}**")
    lines.append(f"- Chunks over `{manifest.settings.target_max_chars}` chars: **{s.chunks_over_target}**")
    lines.append(f"- Chunks over hard max `{manifest.settings.hard_max_chars}` chars: **{s.chunks_over_hard_max}**")
    lines.append(f"- Forced sentence splits: **{s.sentence_splits_forced}**")
    lines.append(f"- Warnings: **{s.warnings_count}**\n")

    # Suspiciously short sections
    short = [c for c in manifest.chunks if c.character_count < manifest.settings.target_min_chars]
    if short:
        lines.append("## Suspiciously short chunks\n")
        lines.append("| Chunk | Chars | Sentences | Starts heading? | Trailing? |")
        lines.append("| --- | --- | --- | --- | --- |")
        for c in short[:25]:
            is_trailing = c is manifest.chunks[-1]
            lines.append(
                f"| `{c.chunk_id}` | {c.character_count} | {c.sentence_count} | "
                f"{'yes' if c.starts_with_heading else 'no'} | {'yes' if is_trailing else 'no'} |"
            )
        lines.append("")

    lines.append("## Pronunciation substitutions\n")
    if manifest.settings.pronunciation_guide_loaded:
        lines.append(f"- Guide: `{manifest.settings.pronunciation_guide_path}`")
        lines.append(f"- Rules loaded: **{manifest.settings.pronunciation_rules_loaded}**")
        lines.append(f"- Distinct terms applied: **{s.pronunciation_distinct_terms_applied}**")
        lines.append(f"- Total substitutions: **{s.pronunciation_substitutions_total}**")
        per_source_rows = []
        for sf in manifest.source_files:
            applied = (sf.pronunciation or {}).get("substitutions_total_count", 0)
            if applied:
                per_source_rows.append(f"  - `{sf.source_file_id}`: {applied} substitution(s)")
        if per_source_rows:
            lines.append("- Per source:")
            lines.extend(per_source_rows)
        lines.append("")
    else:
        lines.append("- No pronunciation guide applied. Pass `--pronunciation-guide PATH`")
        lines.append("  or place a `narrator-pronunciation-guide.md` in the manuscript repo")
        lines.append("  to enable.\n")

    if any(w.severity in ("warning", "error") for w in warnings):
        lines.append("## Warnings\n")
        for w in warnings:
            if w.severity not in ("warning", "error"):
                continue
            scope = f"chunk={w.chunk_id}" if w.chunk_id else (f"source={w.source_file_id}" if w.source_file_id else "")
            lines.append(f"- **{w.severity.upper()}** `{w.code}` {scope}: {w.message}")
        lines.append("")

    lines.append("## Recommended next command\n")
    chunk_dir = (out_dir / "chunks").as_posix()
    lines.append("Once you have the Speechify generation script wired up, point it at the manifest:\n")
    lines.append("```bash")
    lines.append(f"python scripts/generate_speechify_audio.py \\")
    lines.append(f"    --manifest {(out_dir / 'chunk_manifest.json').as_posix()} \\")
    lines.append(f"    --out audio/")
    lines.append("```")
    lines.append("")
    lines.append("After audio is generated, run the QA audit:\n")
    lines.append("```bash")
    lines.append("python audit_audiobook.py \\")
    lines.append(f"    --source-dir {chunk_dir} \\")
    lines.append("    --audio-dir audio/ \\")
    lines.append("    --out reports/")
    lines.append("```\n")

    path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="prepare_audiobook_chunks",
        description="Chunk audiobook source text for Speechify TTS.",
    )
    p.add_argument("--input", type=Path, default=None,
                   help=f"Single .txt file OR directory of .txt files. "
                        f"Default: EMBEDDED_INPUT_DIR ({EMBEDDED_INPUT_DIR}).")
    p.add_argument("--out", type=Path, default=None,
                   help=f"Output directory. "
                        f"Default: EMBEDDED_OUTPUT_DIR ({EMBEDDED_OUTPUT_DIR}).")
    p.add_argument("--min-chars", type=int, default=1500)
    p.add_argument("--max-chars", type=int, default=1800)
    p.add_argument("--hard-max", type=int, default=2000,
                   help="Speechify /v1/audio/speech has a 2000-char limit.")
    p.add_argument("--normalize-quotes", action="store_true",
                   help="Fold curly quotes / em-dashes / ellipses to ASCII.")
    p.add_argument("--no-normalize-whitespace", action="store_true",
                   help="Skip blank-line collapsing.")
    p.add_argument("--no-strip-markdown", action="store_true",
                   help="Keep Markdown scene-break lines (* * *) and *emphasis* asterisks "
                        "in the TTS text instead of stripping them.")
    p.add_argument("--write-txt-chunks", action="store_true",
                   help="Also write each chunk to chunks/<chunk_id>.txt. Automatic "
                        "on later runs once chunks/*.txt exist, so the audit never "
                        "reads stale text after an incremental re-chunk.")
    p.add_argument("--pronunciation-guide", default=None,
                   help=("Path to a markdown pronunciation guide. When provided, listed terms "
                         "are replaced in the chunk text before chunking so the narrator hears "
                         "the safer form. Overrides auto-discovery."))
    p.add_argument("--no-pronunciation-guide", action="store_true",
                   help="Disable pronunciation-guide auto-discovery. No substitutions are applied.")
    p.add_argument("--full", action="store_true",
                   help="Force a full from-scratch re-chunk, ignoring any prior manifest. "
                        "By default, when a chunk_manifest.json already exists in --out, the "
                        "chunker runs INCREMENTALLY: it diffs each chapter against its prior "
                        "chunks, reuses unchanged chunks (keeping their generated audio), and "
                        "only flags edited chunks for regeneration.")
    p.add_argument("--rechunk-threshold", type=float, default=0.5,
                   help="In incremental mode, if more than this fraction of a chapter's sentences "
                        "changed, fall back to a full re-chunk of that chapter (default 0.5).")
    p.add_argument("--only", default=None,
                   help="Comma-separated source IDs to re-chunk (e.g. 'ch00' or 'ch00,ch02'). "
                        "Every OTHER chapter in the prior manifest is passed through unchanged — "
                        "its chunks and audio are not touched. Requires an existing manifest; "
                        "use to scope an edit to one chapter even when a global change (e.g. a "
                        "pronunciation-guide tweak) would otherwise affect others.")
    p.add_argument("--dry-run", action="store_true",
                   help="Incremental preview: report what would be reused / regenerated / pruned "
                        "without writing the manifest, chunk files, or moving any audio.")
    p.add_argument("--verbose", "-v", action="store_true")
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.verbose:
        logger.setLevel(logging.DEBUG)

    # Fill in embedded defaults if --input / --out weren't passed.
    if args.input is None:
        args.input = Path(EMBEDDED_INPUT_DIR).expanduser()
        logger.info("Using embedded default --input: %s", args.input)
    if args.out is None:
        args.out = Path(EMBEDDED_OUTPUT_DIR).expanduser()
        logger.info("Using embedded default --out:   %s", args.out)
    if not args.input.exists():
        raise SystemExit(f"--input path does not exist: {args.input}")

    if args.min_chars > args.max_chars:
        raise SystemExit("--min-chars must be ≤ --max-chars")
    if args.max_chars > args.hard_max:
        raise SystemExit("--max-chars must be ≤ --hard-max")

    # Per-chunk .txt files (chunks/<chunk_id>.txt) are what the downstream audit
    # stage reads. If the output ALREADY contains them, keep them in sync on every
    # run — otherwise an incremental re-chunk updates the manifest but leaves the
    # audit reading stale text (the chunk boundaries/text it audits no longer match
    # the audio it was told to audit). The explicit flag still forces a first write.
    chunks_txt_dir = args.out / "chunks"
    if not args.write_txt_chunks and chunks_txt_dir.is_dir() and any(chunks_txt_dir.glob("*.txt")):
        args.write_txt_chunks = True
        logger.info(
            "Existing per-chunk .txt detected in %s — keeping them in sync "
            "(implicit --write-txt-chunks).", chunks_txt_dir,
        )

    manifest, warnings, applied_substitutions = build_manifest(args)

    if getattr(args, "dry_run", False):
        logger.info(
            "DRY RUN — no manifest/chunks written, no audio moved. "
            "See reports/incremental_reuse_report.md for the preview.",
        )
        return 0

    write_outputs(manifest, warnings, args.out, args.write_txt_chunks, applied_substitutions)

    s = manifest.summary
    logger.info(
        "Wrote %d chunks from %d source file(s): avg=%d, min=%d, max=%d, warnings=%d.",
        s.chunk_count, s.source_file_count, s.average_chunk_characters,
        s.min_chunk_characters, s.max_chunk_characters, s.warnings_count,
    )
    if manifest.settings.pronunciation_guide_loaded:
        logger.info(
            "Pronunciation: %d distinct term(s), %d total substitution(s) applied.",
            s.pronunciation_distinct_terms_applied, s.pronunciation_substitutions_total,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
