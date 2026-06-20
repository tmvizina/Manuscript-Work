---
name: audiobook-text-prep-chunker
description: Prepares audiobook source `.txt` manuscripts for Speechify TTS generation and later QA. Use this skill when the user wants to chunk a book/chapter/manuscript into Speechify-ready segments (~1500-1800 chars, never splitting sentences), produce a chunk manifest with placeholders for downstream Speechify generation, Whisper validation, and repair tracking, or when the user mentions "chunk this book", "prepare for Speechify", "split chapter into chunks", "audiobook text prep", or runs `prepare_audiobook_chunks.py`. Does NOT generate audio, does NOT call Speechify, does NOT run Whisper — text preparation only.
---

# audiobook-text-prep-chunker

This skill takes raw audiobook source text (one or more `.txt` files, typically
chapters of a book) and produces a Speechify-ready chunk manifest plus
per-chunk `.txt` files. The manifest is the single shared object that will
travel through the rest of the pipeline:

```
[this skill]                  [next stages, not invoked here]
prepare_audiobook_chunks  →  speechify generation  →  audit_audiobook (stage 1)  →  triage_repairs (stage 2)
chunk_manifest.json       →  fills speechify.*    →  fills validation.*        →  reads validation, writes repair.*
```

## When to invoke

Invoke this skill when the user wants to:

- Chunk a manuscript / chapter / `.txt` file for Speechify TTS.
- Produce a manifest that downstream Speechify + Whisper + repair scripts will share.
- Re-chunk an updated chapter, reusing unchanged chunks' audio and regenerating
  only what the edit touched (incremental mode — automatic when a manifest
  exists; see **Incremental re-chunk** below).

Do **not** invoke this skill for:

- Generating audio (Speechify gen is a separate, later script).
- Validating existing audio against text (that is the stage-1 audit script).
- Triaging audit results (that is the stage-2 triage script).

## How to run

The script lives at `scripts/prepare_audiobook_chunks.py` and depends only on
the Python standard library.

```bash
# Single file
python scripts/prepare_audiobook_chunks.py \
    --input "Chapter 00 - Prologue.txt" \
    --out prepared_audiobook/

# A folder of chapter files
python scripts/prepare_audiobook_chunks.py \
    --input input_chapters/ \
    --out prepared_audiobook/

# Custom chunk-size targets (Speechify's hard limit is 2000 chars)
python scripts/prepare_audiobook_chunks.py \
    --input input_chapters/ \
    --out prepared_audiobook/ \
    --min-chars 1500 --max-chars 1800 --hard-max 2000

# Also write per-chunk .txt files (the audit step expects these)
python scripts/prepare_audiobook_chunks.py \
    --input input_chapters/ \
    --out prepared_audiobook/ \
    --write-txt-chunks
```

## Incremental re-chunk (automatic) — only regenerate what changed

When a `chunk_manifest.json` **already exists** in `--out`, the chunker runs
**incrementally** by default. It diffs each chapter against its prior chunks and
**reuses the unchanged chunks** — their text, their already-generated audio, and
their downstream `speechify`/`validation`/`repair` state — so only the chunks an
edit actually touched are flagged for regeneration.

How it decides:

1. **Anchored reuse.** A whole prior chunk is reused when an unchanged run of
   sentences covers it exactly, so a localized edit (even at the *top* of a long
   chapter) does not reflow-and-regenerate the rest of the chapter.
2. **Byte-exact safety net.** Any freshly-packed chunk whose final text is
   identical (hash-equal) to an unused prior chunk also reuses that chunk's
   audio. This recovers force-split sentences, heading blocks, and boundaries
   that re-synced after an edit — cases a sentence diff can't align.
3. **Full re-chunk fallback.** If more than `--rechunk-threshold` (default 0.5)
   of a chapter's sentences changed, that chapter is re-chunked from scratch and
   every chunk regenerates ("larger regeneration").

Audio bookkeeping (clean sequential IDs are re-derived every run):

- Reused chunks whose ID shifted have their `<id>.mp3` + `<id>.speechmarks.json`
  **renamed** into the new slot.
- Retired / replaced chunks' audio is **pruned**.
- Regenerated chunks are left with **no** audio file, so the resume-safe
  Speechify generator (which skips a chunk only when its `.mp3` exists)
  regenerates exactly those.

A changed pronunciation guide is handled correctly: every chunk whose spoken
text changes because a rule changed is regenerated; the rest are reused.

```bash
# Preview only — no manifest/chunk writes, no audio moved. Writes
# reports/incremental_reuse_report.md so you can see reuse vs regen per chapter.
python scripts/prepare_audiobook_chunks.py --out prepared_audiobook/ --dry-run

# Force a full from-scratch re-chunk, ignoring the prior manifest.
python scripts/prepare_audiobook_chunks.py --out prepared_audiobook/ --full

# Scope the re-chunk to one chapter — every OTHER chapter passes through
# unchanged (chunks + audio untouched). Use this to confine an edit to one
# chapter even when a global change (e.g. a pronunciation-guide tweak) would
# otherwise touch others.
python scripts/prepare_audiobook_chunks.py --out prepared_audiobook/ --only ch00
```

Reuse vs. regeneration is reported in
`reports/incremental_reuse_report.{md,json}`.

## Outputs

```
prepared_audiobook/
  chunk_manifest.json           # compact (downstream tools read this)
  chunk_manifest.pretty.json    # indented (humans read this)
  chunks/
    ch00_0001.txt               # --write-txt-chunks (auto-kept-in-sync once present; the audit reads these)
    ch00_0002.txt
  _gen/                         # per-chapter audio dir the LATER generation stage fills;
    ch00/                       #   this skill only RENAMES/PRUNES it in incremental mode
      ch00_0001.mp3             #   (it never generates audio). Audio is NOT created here by this skill.
  reports/
    chunking_summary.md
    chunking_warnings.json
```

## Chunking rules in one screen

1. Never split a sentence unless it alone exceeds `--hard-max` (default 2000).
2. Boundary preference: section heading → paragraph → sentence → clause.
3. Target chunk size 1500–1800 chars; chunks up to `--hard-max` are accepted
   when a whole sentence makes them unavoidable.
4. Rebalance trailing tiny chunks by peeling one or two sentences from the
   previous chunk.
5. `chunk_id` is `<source_id>_<NNNN>` where `<source_id>` is `ch<NN>` when a
   chapter number can be inferred, otherwise `file<NNN>`.

## Important non-actions

- Does **not** call Speechify.
- Does **not** generate audio.
- Does **not** run Whisper.
- Does **not** modify the source text on disk.
- In **incremental mode it does rename/prune existing chunk audio** under
  `<out>/_gen/<source_id>/` (e.g. `<out>/_gen/ch00/ch00_0001.mp3`) — the same
  per-chapter layout the generator and repair-executor use — to keep reused
  chunks paired with their new IDs and to remove retired audio. Use `--dry-run`
  to preview, or `--full` to skip incremental reuse entirely. (It never touches
  the source `.txt` manuscripts.)
- It **does keep the per-chunk `chunks/<id>.txt` files in sync** whenever they
  already exist (the downstream audit reads them), so an incremental re-chunk
  never leaves the audit reading stale text — even if `--write-txt-chunks` is
  omitted. The flag is only needed to create them on the first run.

## Next step after this skill finishes

The summary at `prepared_audiobook/reports/chunking_summary.md` ends with the
exact next-stage command (Speechify generation). Surface that to the user.
