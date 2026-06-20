# Book Writer

The **text** half of a fantasy-novel production pipeline. This repo holds the skills
and the chunking tool that take a writing prompt all the way to a finished, formatted
manuscript and the chunk + manifest pair that downstream audiobook repos consume.

It was extracted from a larger proof-of-concept ("POC") tree that mixed manuscript
authoring, audio generation, and image work together. This repo isolates **authoring
only**: prompt → reviewed → planned → written → formatted → chunked. Audio, cloud
audit, image-prompt, and image-generation work all live in sibling repos and are
deliberately out of scope here.

You do **not** need to have seen the POC to use this repo. Everything you need to
understand the inputs, outputs, and the format of each artifact is included as a
sample under `samples/`.

---

## What goes in, what comes out

**Input** — a writing prompt. In practice that is one of:
- a brief / chapter direction ("write the next chapter where X happens"), or
- a **review report** (from `book-reviewer`) plus an **editing plan** (from
  `manuscript-editing-planner`) that the writer skill executes.

**Output** — three things, in order of the pipeline:
1. a **compiled, formatted manuscript** (clean novel-ready chapter `.txt` files), then
2. **chunked text** — `chunks/chXX_NNNN.txt`, ~1500–1800 characters each, never
   splitting a sentence, and
3. a **chunk manifest** — `chunk_manifest.json` (machine) plus a human-readable
   `chunk_manifest.pretty.json`.

The **chunk + manifest pair is the hand-off boundary**: it is the documented contract
that the Local Audiobook Generator and Cloud Audiobook Repairer repos read as their
input. That is why the chunker lives here, in the writing repo — chunking is the last
step of writing, not the first step of audio.

---

## The pipeline (review → plan → write → format → chunk)

Each step is a skill under `skills/`. Most steps ship a **v1** and an enhanced **v2**.
v1 is fine for quick one-offs; **v2 is the recommended default** for any real pass
(stable cross-referenceable IDs, voice-drift gates, dependency graphs, world/-memory
awareness).

| # | Step | Skill (v1 / v2) | What it does | Reads | Writes |
|---|------|------------------|--------------|-------|--------|
| 1 | **Review** | `book-reviewer` / `book-reviewer-v2` | Reads the manuscript and produces a review report: continuity, motif/repetition audits, character arcs, pacing, audiobook readiness. v2 emits stable `RV-NNN` finding IDs. | manuscript `.txt` | review report `.md` |
| 2 | **Plan** | `manuscript-editing-planner` / `manuscript-editing-planner-v2` | Turns the review report into a structured editing plan: book-structure recommendations, chapter-split proposals, and per-chapter edit plans. v2 emits `EP-NNN` plan IDs that reference the `RV-NNN` findings, plus a dependency graph and conflict detection. | review report `.md` | editing plan `.md` (overall + per-chapter) |
| 3 | **Write** | `manuscript-writer` / `manuscript-writer-v2` | Executes the editing plan. For each finding it decides **implement / push back / suggestion-only**, with reasoning. It only commits accepted edits; proposed rewrites go to a sidecar `.md` for human approval. v2 adds a voice fingerprint and a self-diff voice gate. | editing plan `.md` + manuscript | edited manuscript `.txt` (+ sidecar of suggestions) |
| — | **Title cleanup** (as needed) | `chapter-title-cleanup` | Audits, renumbers, and standardizes chapter/part/section/file titles **without** rewriting prose. Produces a title map and an audit. Run whenever chapter numbering or titles drift. | chapter files / titles | title audit + title map JSON |
| 4 | **Format** | `novel-formatting` | Formats chapter files into clean, consistent, novel-ready Markdown/plain text — consistent headings, scene breaks, paragraph spacing, audiobook-friendly output. Preserves prose and chapter order. | manuscript `.txt` | compiled/formatted manuscript |
| 5 | **Chunk** | `audiobook-text-prep-chunker` | Splits finished chapter `.txt` into Speechify-ready chunks and builds the manifest. **This is the hand-off output.** Text-prep only — it does **not** call Speechify or Whisper. | formatted chapter `.txt` | `chunks/chXX_NNNN.txt` + `chunk_manifest.json` / `.pretty.json` |

The loop is iterative: review → plan → write, repeat, then format and chunk once the
prose is settled.

### Before the pipeline: from idea to plan (new — design)

The table above starts from a *writing prompt* — it assumes the story already exists. A
newer **front of the pipeline** adds the stages that turn a human's raw idea into a
writer-ready plan, *before* review/plan/write. These three skills are **design +
scaffolding** (complete `SKILL.md` + templates; no runner yet):

| # | Stage | Skill | What it does | Reads | Writes |
|---|------|-------|--------------|-------|--------|
| 0a | **Sketch** | *(human)* | The human supplies the seed: premise, outline, or beats. The only mandatory human-authored artifact at the top. | — | a rough sketch |
| 0b | **Enhance** | `outline-enhancer` (the dramaturg) | Deepens the sketch and **seeds the `world/` memory** the rest of the pipeline reads as canon — characters (`CHAR-NNN`), threads (`THR-NNN`, plant/grow/harvest), arcs (`ARC-NNN`). Marks unresolved directions campaign-pending instead of inventing them. | human sketch | enriched outline + seeded `world/` |
| 0c | **Arc gate** | `story-arc-reviewer` (the arc gate) | Confirms arc direction **with the author** — a deliberate human checkpoint. Turns proposed arcs into questions (`AQ-NNN`), records answers (`AC-NNN`), resolves campaign-pending items only when the author decides. | enriched outline + `world/` | human-validated outline |
| 0d | **Generation plan** | `manuscript-planner` (the generation planner) | Turns the validated outline into a writer-ready **generation guide** (`GP-NNN`): chapter targets, scene briefs, per-chapter thread beats, voice/continuity anchors. The bridge to "write it." | validated outline + `world/` | generation guide |

> **`manuscript-planner` vs `manuscript-editing-planner`** — different planners at opposite
> ends of the pipeline. `manuscript-planner` plans the *first generation* of prose that
> doesn't exist yet (validated outline → generation guide). `manuscript-editing-planner`
> plans *revisions* to an existing draft from reviewer findings (RV → EP).

See **`FRONT-OF-PIPELINE.md`** for the full design, the combined diagram, and the ID
schemes.

> **Skill default paths point at the POC.** A few SKILL.md files mention a default
> manuscript repo path (`~/RiderProjects/RoadBeneathDragonsWings/`). That is just the
> POC convention these skills were authored against. The skills are book-agnostic —
> point them at whatever manuscript repo you are working in.

---

## Folder map

```
book-writer/
  README.md               <- this file
  PLAN.md                 <- how this repo was built (build guide)
  DESIGN-DECISIONS.md     <- why it is shaped this way (rationale + open questions)
  FRONT-OF-PIPELINE.md    <- design of the new front stages (idea -> writer-ready plan)
  skills/
    outline-enhancer/               <- front of pipeline (design): deepen + seed world/
    story-arc-reviewer/             <- front of pipeline (design): arc gate, human-in-loop
    manuscript-planner/             <- front of pipeline (design): outline -> generation guide
    book-reviewer/                  book-reviewer-v2/
    manuscript-editing-planner/     manuscript-editing-planner-v2/
    manuscript-writer/              manuscript-writer-v2/
    chapter-title-cleanup/
    novel-formatting/
    audiobook-text-prep-chunker/    <- includes scripts/ (the chunker CLI)
  samples/
    manuscript/   Chapter 01 - The First Broken Seal.txt   <- one finished chapter
    chunks/       ch01_0001.txt                            <- one chunk
    manifests/    chunk_manifest.pretty.json               <- trimmed manifest (first 2 chapters; format reference)
    reports/      2026-06-13-initial-chapter-by-chapter-review.md   <- a review report (step 1 output)
                  Chapter 01 - The First Broken Seal - edit-plan.md <- an editing plan (step 2 output)
```

Each skill folder is a complete Claude Code skill: a `SKILL.md` plus its
`templates/`, `reference/`, `examples/`, and/or `scripts/`. Drop `skills/` into your
`~/.claude/skills` (or point your skill loader at it) to use them.

---

## Naming conventions (kept as-is from the source)

- **Chapters:** `Chapter NN - Title.txt`. `NN` may be fractional for inserted
  chapters (`00.5`, `07.6`).
- **Chunks:** `chXX_NNNN.txt`, where `chXX` is the manifest's `source_file_id`
  (e.g. `ch01_0001.txt` = chapter 1, chunk 1).
- **Manifest:** `chunk_manifest.json` (machine) plus `chunk_manifest.pretty.json`
  (human-readable, indented).
- **Chunk size:** target 1500–1800 chars, **hard max 2000** (Speechify's per-request
  limit), and a sentence is never split across a chunk boundary.

---

## Sample-driven walkthrough

The four `samples/` folders let you trace one chapter through the whole pipeline
without any of the POC. Open them in pipeline order:

1. **A review report** — `samples/reports/2026-06-13-initial-chapter-by-chapter-review.md`.
   This is what step 1 (`book-reviewer`) produces from a manuscript: chapter-by-chapter
   findings, continuity notes, motif observations.

2. **An editing plan** — `samples/reports/Chapter 01 - The First Broken Seal - edit-plan.md`.
   This is what step 2 (`manuscript-editing-planner`) produces from that review: the
   concrete per-chapter edits the writer will triage in step 3.

3. **A finished chapter** — `samples/manuscript/Chapter 01 - The First Broken Seal.txt`.
   The output of write + format: clean, novel-ready chapter prose. This is the input
   to chunking.

4. **A chunk** — `samples/chunks/ch01_0001.txt`. The first ~1.5–1.8 KB slice of that
   chapter, as the chunker emits it. Note it ends on a clean sentence boundary.

5. **The manifest** — `samples/manifests/chunk_manifest.pretty.json`. A **trimmed**
   copy (first 2 chapters: `ch00`, `ch00_5`) of a real book manifest, included as a
   **format reference** (the full book has 51 source_files / 912 chunks; see the
   `_sample_note` field). Inspect the top-level `settings` block (chunk-size targets,
   pronunciation guide), the `source_files` array (one entry per chapter, with
   `source_file_id`, `source_hash`, char counts), and the per-chunk records that
   follow. Every chunk file like `ch00_0001.txt` has a matching record here.

### Run the chunker yourself

You can reproduce step 5 from the sample chapter. The chunker is pure-Python with no
third-party dependencies:

```bash
cd "skills/audiobook-text-prep-chunker"

python3 scripts/prepare_audiobook_chunks.py \
  --input "../../samples/manuscript/Chapter 01 - The First Broken Seal.txt" \
  --out   /tmp/book-writer-chunk-demo \
  --write-txt-chunks \
  --verbose
```

This writes `chXX_NNNN.txt` chunk files plus a fresh `chunk_manifest.json` and
`chunk_manifest.pretty.json` into `/tmp/book-writer-chunk-demo`. Compare the generated
chunks against `samples/chunks/ch01_0001.txt` and the generated manifest against
`samples/manifests/chunk_manifest.pretty.json` to see the format match.

Useful flags (full list via `python3 scripts/prepare_audiobook_chunks.py --help`):
- `--min-chars` / `--max-chars` / `--hard-max` — chunk-size targets (default 1500 / 1800 / 2000).
- `--dry-run` — report what would be chunked without writing files.
- `--full` — force a from-scratch re-chunk (default is incremental: it reuses unchanged
  chunks so previously generated audio stays valid).
- `--pronunciation-guide PATH` — substitute hard-to-pronounce terms before chunking.

### A note on the manifest's paths

The sample `chunk_manifest.pretty.json` contains absolute **Windows** paths
(`C:\Users\tmviz\...`) in fields like `settings.pronunciation_guide_path` and each
`source_files[].path`. That is intentional and left **as-is** so the sample documents
the real format. These paths are written by the chunker at run time and are
**environment-specific** — when you run the chunker on your machine, it records your
own absolute paths. Do not treat the sample's paths as something to "fix."

---

## What's deliberately not here

- **Audio** (Speechify generation, stitching, repair) → Local Audiobook Generator repo.
- **Cloud audit** of generated audio → Cloud Audiobook Repairer repo.
- **Image prompts / image generation** → the image repos.
- **World canon, journals, and the full review/editing-plan archives** are not bulk-copied.
  Only one sample of each artifact format is included here to teach the loop, not to
  migrate data. The real manuscript and full chunk/manifest sets stay in the source repo.

See `DESIGN-DECISIONS.md` for the rationale behind these boundaries and the open questions.
