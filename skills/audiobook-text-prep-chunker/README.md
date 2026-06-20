# audiobook-text-prep-chunker

Claude Code skill that prepares audiobook source `.txt` files for Speechify
TTS generation and downstream QA. Splits manuscripts into Speechify-ready
chunks (1500–1800 chars, never breaking a sentence unless one alone exceeds
the 2000-char hard cap), and emits a manifest that the rest of the audiobook
pipeline writes into.

> **This skill does not generate audio.** It does not call Speechify, does not
> run Whisper, does not modify your source files on disk. Text preparation
> only.

---

## What this skill is part of

```
1. audiobook-text-prep-chunker  ← this skill
       ↓ chunk_manifest.json
2. Speechify generation (separate script — fills `speechify.*` blocks)
       ↓
3. audit_audiobook.py           (stage-1 audit — fills `validation.*`)
       ↓ audiobook_audit_report.json
4. triage_repairs.py            (stage-2 triage — writes `repair.*`)
       ↓
5. Repair / splice script       (your downstream tool)
```

The manifest produced here is the shared object passed all the way through
the pipeline. Each later stage writes into pre-allocated slots — no later
stage needs to invent IDs or recompute ordering.

---

## Install

Zero dependencies. Python 3.10+ standard library only.

```bash
# No pip install needed.
python --version
```

---

## Usage

```bash
# Single file
python scripts/prepare_audiobook_chunks.py \
    --input "Chapter 00 - Prologue.txt" \
    --out prepared_audiobook/

# A folder of chapter files (sorted by filename)
python scripts/prepare_audiobook_chunks.py \
    --input input_chapters/ \
    --out prepared_audiobook/

# Custom chunk targets
python scripts/prepare_audiobook_chunks.py \
    --input input_chapters/ \
    --out prepared_audiobook/ \
    --min-chars 1500 --max-chars 1800 --hard-max 2000

# Also write each chunk to its own .txt (audit stage 1 needs these)
python scripts/prepare_audiobook_chunks.py \
    --input input_chapters/ \
    --out prepared_audiobook/ \
    --write-txt-chunks

# Fold curly quotes / em-dashes to ASCII (off by default — preserves typography)
python scripts/prepare_audiobook_chunks.py \
    --input input_chapters/ \
    --out prepared_audiobook/ \
    --normalize-quotes
```

### Flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--input` | _required_ | Single `.txt` file or directory of `.txt` files. |
| `--out` | _required_ | Output directory (created if missing). |
| `--min-chars` | `1500` | Target floor. |
| `--max-chars` | `1800` | Target ceiling. |
| `--hard-max` | `2000` | Absolute cap — Speechify `/v1/audio/speech` limit. |
| `--normalize-quotes` | off | Fold curly quotes, em-dashes, ellipses to ASCII. |
| `--no-normalize-whitespace` | off | Skip blank-line collapsing. |
| `--write-txt-chunks` | off | Also write `chunks/<chunk_id>.txt` for each chunk. |
| `--verbose / -v` | off | DEBUG logging. |

---

## Outputs

```
prepared_audiobook/
  chunk_manifest.json          # compact (downstream tools read this)
  chunk_manifest.pretty.json   # indented (humans read this)
  chunks/                      # only when --write-txt-chunks
    ch00_0001.txt
    ch00_0002.txt
  reports/
    chunking_summary.md
    chunking_warnings.json
```

### Chunk IDs

- Chapter detected from filename (`Chapter 00 - …`, `ch00.txt`, etc.) →
  `ch00_0001`, `ch00_0002`, …
- No chapter detected → `file001_0001`, `file001_0002`, … (preserves order
  across multiple files).

### Stable across re-runs

- Source files are sorted by basename before chunking.
- `source_hash` is the SHA-256 of the normalized source.
- `text_hash` is the SHA-256 of the chunk text.
- Running again over the same input produces the same `chunk_id`s and hashes.

---

## Chunking rules

1. **Never split a sentence** unless one alone exceeds `--hard-max`. In that
   case, fall back to clause boundaries (`;`, `:`, em-dash, comma) and mark
   `forced_sentence_split: true` on the affected chunk. A warning is logged.
2. **Boundary preference cascade** at every step:
   1. Section heading (markdown `#`, `Chapter N`, `Prologue`, ALL-CAPS short
      lines).
   2. Paragraph break.
   3. Sentence boundary.
   4. Clause boundary (only when 1–3 are impossible).
3. **Size policy**:
   - Try to land each chunk in `[--min-chars, --max-chars]`.
   - Accept chunks up to `--hard-max` when a whole sentence would otherwise
     force a mid-sentence split.
   - Never exceed `--hard-max`.
4. **Trailing rebalance**: if the last chunk lands below `min_chars * 0.6`
   and the previous chunk has slack, peel sentences forward.
5. **Headings**: when a heading lands at a chunk boundary, the chunk after
   it gets `starts_with_heading: true`.

---

## Manifest shape

See [`examples/sample_chunk_manifest.json`](examples/sample_chunk_manifest.json)
for a real, end-to-end example.

Top level:

```jsonc
{
  "project": "audiobook_text_prep",
  "created_at": "ISO-8601",
  "settings": { /* what knobs were used */ },
  "source_files": [ /* per-file metadata + source_hash */ ],
  "chunks":       [ /* per-chunk records */ ],
  "summary":      { /* aggregate counts */ }
}
```

Each chunk includes pre-allocated placeholders the later pipeline stages fill in:

```jsonc
{
  "chunk_id": "ch00_0001",
  "sequence_global": 1,
  "sequence_in_source": 1,
  "text": "…",
  "character_count": 1800,
  "starts_with_heading": true,
  "ends_at_sentence_boundary": true,
  "ends_at_paragraph_boundary": false,
  "forced_sentence_split": false,
  "text_hash": "…",
  "context": {
    "previous_chunk_id": null,
    "next_chunk_id": "ch00_0002",
    "first_sentence": "…",
    "last_sentence": "…",
    "previous_context": "",
    "next_context": "…"
  },
  "speechify": {
    "status": "not_generated",
    "voice_id": null,
    "audio_file": null,
    "generation_attempts": []
  },
  "validation": {
    "status": "not_validated",
    "whisper_passes": [],
    "overall_similarity": null,
    "missing_text_flags": [],
    "artifact_flags": [],
    "human_review_required": false,
    "approved_for_final": false
  },
  "repair": {
    "repair_status": "not_needed",
    "repair_items": [],
    "patched_audio_file": null,
    "repair_notes": []
  }
}
```

---

## Example

A 3-paragraph sample chapter is included at
[`examples/sample_input.txt`](examples/sample_input.txt). Run:

```bash
python scripts/prepare_audiobook_chunks.py \
    --input examples/sample_input.txt \
    --out /tmp/sample_out/ \
    --write-txt-chunks
```

That produces:

- 2 chunks: 1800 chars + 1325 chars (avg 1562).
- `starts_with_heading: true` on chunk 1.
- No forced splits, no warnings.

The committed `examples/sample_chunk_manifest.json` and
`examples/sample_chunking_summary.md` are exactly what the script produced
when run against a chapter-named copy of `sample_input.txt`.

---

## Limitations

- **No language model in the loop.** Sentence segmentation is regex +
  abbreviation list; very abbreviation-heavy text may produce odd
  boundaries.
- **Heading detection is heuristic.** ALL-CAPS lines and `Chapter N`/
  `Prologue`/`Epilogue` are caught. Roman-numeral chapter markers
  (`I.`, `II.`) on their own line are caught. Anything more exotic
  isn't — you can pre-edit the source to add a markdown `#` heading
  if you want to force a chunk break.
- **No audio limits modelled.** The 2000-char cap is character-count
  only. If you're hitting Speechify rate or duration limits, lower
  `--max-chars`.
- **Single-pass packer.** The trailing rebalance is local (last two
  chunks only). Very short final files can still produce a short
  trailing chunk; the summary flags those.
- **UTF-8 first, latin-1 fallback.** Non-UTF-8 files are read with
  latin-1 and a warning is emitted; consider re-encoding upstream.

---

## Project layout

```
audiobook-text-prep-chunker/
  SKILL.md
  README.md
  scripts/
    prepare_audiobook_chunks.py
  examples/
    sample_input.txt
    sample_chunk_manifest.json
    sample_chunking_summary.md
```
