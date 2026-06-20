# PLAN — Book Writer repo

> Build guide for the worker. Follow top to bottom. Do the self-check at the end.
> You have READ-ONLY access to the POC; never modify it.

## Constants
- **POC root:** `/Users/tmvizina/RiderProjects/RoadBeneathDragonsWings`
- **Live skills dir:** `~/.claude/skills` (full, canonical copies)
- **Repo skill mirror (alt source):** `<POC>/tools/<skill>` (only some skills present)
- **This repo root:** `/Users/tmvizina/RiderProjects/Cleaner Split Purpose Repos/book-writer`

## Purpose / Inputs / Outputs
- **Purpose:** Author the manuscript end to end.
- **Inputs:** writing prompts (a brief, a chapter direction, a review report).
- **Outputs:** compiled book (formatted manuscript) + chunked text + chunk manifests
  (the chunk + manifest pair is the hand-off boundary to the audiobook repos).

## What to mine from the POC
Copy the SKILL directories (whole folders: `SKILL.md`, `scripts/`, `reference/`,
`examples/`). Prefer `~/.claude/skills/<skill>` (live). These are the manuscript skills:

| Skill | Source |
|---|---|
| book-reviewer (v1) | `~/.claude/skills/book-reviewer` |
| book-reviewer-v2 | `~/.claude/skills/book-reviewer-v2` (mirror: `<POC>/tools/book-reviewer-v2`) |
| manuscript-editing-planner (v1) | `~/.claude/skills/manuscript-editing-planner` |
| manuscript-editing-planner-v2 | `~/.claude/skills/manuscript-editing-planner-v2` (mirror in tools/) |
| manuscript-writer (v1) | `~/.claude/skills/manuscript-writer` |
| manuscript-writer-v2 | `~/.claude/skills/manuscript-writer-v2` (mirror in tools/) |
| chapter-title-cleanup | `~/.claude/skills/chapter-title-cleanup` |
| novel-formatting | `~/.claude/skills/novel-formatting` |
| audiobook-text-prep-chunker | `~/.claude/skills/audiobook-text-prep-chunker` (mirror in tools/) |

> The **chunker lives here** (not in the audiobook repos): chunking is the last step
> of the writing pipeline and produces this repo's hand-off output.

## Sample artifacts to copy (SAMPLES ONLY — never bulk)
- **One chapter .txt** — copy `<POC>/chapters/Chapter 01 - The First Broken Seal.txt`
  into `samples/manuscript/`.
- **One chunk file** — copy `<POC>/audiobook-prep/book-1/chunks/ch01_0001.txt`
  into `samples/chunks/`.
- **One chunk manifest** — copy `<POC>/audiobook-prep/book-1/chunk_manifest.pretty.json`
  into `samples/manifests/` (the `.pretty.json` is human-readable; that's why we take it).
- Optional: one review report from `<POC>/reviews/` and one editing plan from
  `<POC>/editing-plan/` into `samples/reports/` so a new user sees the review→plan→write loop.

## Target flattened structure
```
book-writer/
  README.md
  PLAN.md
  DESIGN-DECISIONS.md
  skills/
    book-reviewer/            book-reviewer-v2/
    manuscript-editing-planner/   manuscript-editing-planner-v2/
    manuscript-writer/        manuscript-writer-v2/
    chapter-title-cleanup/    novel-formatting/
    audiobook-text-prep-chunker/
  samples/
    manuscript/   <- one chapter .txt
    chunks/       <- one chunk .txt
    manifests/    <- one chunk_manifest.pretty.json
    reports/      <- (optional) one review + one editing plan
```

## Path-fix step
The sample `chunk_manifest.pretty.json` contains absolute Windows paths
(`C:\Users\tmviz\...`). Leave the sample file's contents AS-IS (it documents the
real format) but note in the README that paths are produced by the chunker at run
time and are environment-specific.

## README requirements
Explain: what this repo is; the review → plan → write → format → chunk pipeline;
which skill does which step; the input (a prompt) and outputs (compiled book +
chunks + manifest); and a sample-driven walkthrough using `samples/`. Write it for
someone who has never seen the POC.

## Self-check (Definition of done)
- [ ] All listed skill folders copied under `skills/`.
- [ ] One chapter, one chunk, one manifest sample present (plus optional reports).
- [ ] Flattened structure matches the tree above.
- [ ] README explains structure + inputs/outputs + sample walkthrough.
- [ ] PLAN.md and DESIGN-DECISIONS.md present.
- [ ] POC untouched.
