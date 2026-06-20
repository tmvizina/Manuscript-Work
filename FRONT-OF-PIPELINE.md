# Front of the Pipeline — From Idea to Writer-Ready Plan

> **Status: DESIGN.** The three skills described here are newly added as the *front*
> of the pipeline — the stages that turn a human's idea into something the existing
> writer bot can build from. They sit *before* the established
> review → plan → write → format → chunk loop documented in `README.md`.

## The problem this solves

The existing pipeline (see `README.md`) is excellent at taking a *writing prompt* and
running it to a finished, chunked manuscript. But it assumes the story already exists —
it starts from a brief or, more often, from a review of prose already written. There was
no machine support for the step *before* that: a human turning a rough idea into a
structured, memory-seeded plan the writer can generate from.

These three stages fill that gap. They help a human **iterate and shape their plan**
before handing it to the existing skills.

## The full pipeline, with the new front

```
   ┌─────────────────────── FRONT OF PIPELINE (new — design) ───────────────────────┐
   │                                                                                  │
   │  human sketch       outline-enhancer      story-arc-reviewer    manuscript-      │
   │  ┌──────────┐       ┌──────────────┐      ┌──────────────┐      planner          │
   │  │ premise/ │  ───► │ deepen + seed│ ───► │ arc gate +   │ ───► ┌──────────────┐ │
   │  │ outline/ │       │ world/ memory│      │ HUMAN check  │      │ validated    │ │
   │  │ beats    │       │ (ARC/THR/CHR)│      │ (validated)  │      │ outline →    │ │
   │  └──────────┘       └──────┬───────┘      └──────┬───────┘      │ generation   │ │
   │   (only required           │ writes              │ asks         │ guide        │ │
   │    human input)            ▼                 the AUTHOR         └──────┬───────┘ │
   │                          world/  ◄── read as canon by every stage ─────┘         │
   └──────────────────────────────────────────────────────────────────────────┼──────┘
                                                                               │
                                                                               ▼
   ┌──────────────────────── EXISTING PIPELINE (implemented) ──────────────────────────┐
   │  manuscript-writer ──► book-reviewer ──► manuscript-editing-planner ──► writer ──► │
   │  novel-formatting ──► audiobook-text-prep-chunker  (review→plan→write loop, then   │
   │  format, then chunk; the chunk + manifest pair is the hand-off boundary)           │
   └────────────────────────────────────────────────────────────────────────────────────┘
```

## The three new stages

### 1. Human sketches the idea (the only mandatory human-authored input)
The human supplies the seed: a rough outline, a premise, a set of beats — whatever shape
the idea arrives in. Everything downstream builds on this.

### 2. `outline-enhancer` — the dramaturg
Takes the sketch and **deepens** it, and **seeds the `world/` memory system** the rest of
the pipeline reads as canon.

- Analyzes the story arc implied by the sketch.
- Opens **character threads** in `world/characters/` (stable `CHAR-NNN` IDs) — who each
  character is, what they want, where their arc bends.
- Fleshes out the story: fills gaps, proposes structure, and surfaces the threads worth
  **planting / growing / harvesting** (`world/threads/thread-map.md`, `THR-NNN`).
- Maps the major arcs (`world/arcs/arc-map.md`, `ARC-NNN`).
- **Marks what it cannot resolve as campaign-pending** rather than inventing an answer.
- **Output:** an enriched outline (`outline/enriched-outline.md`, beats `OB-NNN`) plus a
  seeded `world/` (characters, threads, arcs) and an open-questions list.

It is the **first writer into `world/`**; every later stage only reads it as canon.

### 3. `story-arc-reviewer` — the arc gate (human in the loop)
Reviews the enriched arcs and **confirms them with the author** before anything downstream
commits.

- Turns every proposed/pending arc into a concrete **question** (`AQ-NNN`).
- **Asks the human** — this is a deliberate human checkpoint, not an autonomous pass. The
  bot does not assume; it verifies arc direction with the author.
- Captures answers as confirmations (`AC-NNN`), resolves campaign-pending items **only when
  the author decides them**, and updates `world/` canon to match.
- **Output:** a human-validated outline (`outline/validated-outline.md`).

This mirrors the **campaign-pending discipline** already in the repo: some narrative
decisions are the author's (or the D&D table's) to make. The arc gate is where those get
surfaced and confirmed rather than invented.

### 4. `manuscript-planner` — the generation planner
Turns the validated outline into a **writer-ready generation guide**.

- Converts arcs and beats into chapter targets, scene briefs, per-chapter thread beats
  (PLANT/GROW/HARVEST), and voice/continuity anchors (`GP-NNN`).
- The **bridge artifact** between "what the story is" and "write it."
- Preserves author-retained campaign-pending threads as **plant/grow-only**.
- **Output:** a generation guide (`generation-guide/`) consumed by the writer — the first
  implemented stage of the existing pipeline.

> **Not the editing planner.** `manuscript-planner` plans the *first generation* of prose
> that does not exist yet. `manuscript-editing-planner` plans *revisions* to an existing
> draft from the lector's findings (RV → EP). They are different planners at opposite ends
> of the pipeline. See the ID-scheme table below.

## ID schemes (front of pipeline)

| Stage | Mints | Dated? | Notes |
|---|---|---|---|
| outline-enhancer | `CHAR-NNN`, `THR-NNN`, `ARC-NNN`, `OB-NNN` | No (persistent canon entities) | Entities live in `world/`; never renumbered, supersede instead. |
| story-arc-reviewer | `AQ-YYYY-MM-DD-NNN`, `AC-YYYY-MM-DD-NNN` | Yes (review event) | Questions to the author and their recorded answers. |
| manuscript-planner | `GP-YYYY-MM-DD-NNN` | Yes (planning event) | Chapter targets / scene briefs; reference `OB`/`THR`/`ARC`/`CHAR`. |

For comparison, the existing back half uses `RV-NNN` (reviewer), `EP-NNN` (editing
planner), and `WP-NNN` (writer).

## How `world/` ties it together

`world/` is the shared canon store. The front of the pipeline **writes** it; the back half
**reads** it:

- `outline-enhancer` **seeds** `world/characters/`, `world/threads/thread-map.md`,
  `world/arcs/arc-map.md`, plus `world/voice-bible/` and `world/continuity/` stubs.
- `story-arc-reviewer` **updates** `world/arcs` and `world/threads` with the author's
  confirmed decisions.
- `manuscript-planner` **reads** all of it to build the generation guide.
- The existing `book-reviewer-v2`, `manuscript-editing-planner-v2`, and
  `manuscript-writer-v2` already read `world/` as canon — so the front of the pipeline is
  simply filling, at genesis, the memory those skills expect to find.

This also resolves an open question recorded in `DESIGN-DECISIONS.md` ("Should `world/`
canon travel with this repo?"): the front-of-pipeline skills are the ones that *create*
`world/`, so the directory's shape is now documented here even though no bulk canon data is
copied into the repo.

## Status and scope

- These three skills are **design + scaffolding**: complete `SKILL.md` definitions and
  templates, consistent with the existing skills' conventions (frontmatter, `world/`
  integration, campaign-pending discipline, stable IDs, v-style "will / will not" sections).
- They are **not yet wired to a runner** and ship no scripts. They define the contract
  each stage produces and consumes.
- The hand-off boundary at the *back* of the pipeline (chunk + manifest) is unchanged. This
  work only adds a hand-off boundary at the *front*: **validated outline → generation
  guide → writer.**
