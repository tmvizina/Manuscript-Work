# Command Reference — Skills Mapped to Slash Commands

Every skill in this repo's `skills/` folder now has a matching slash command in `.claude/commands/`. Type `/` in Claude Code inside this repo and they appear in the menu. Each command invokes its skill, and if the skill isn't installed on the machine, falls back to reading the skill file straight out of `skills/` — so the commands work on any computer that has this repo, with nothing extra installed.

## Generation half — idea → first draft (in pipeline order)

| Command | Stage | What it does |
|---|---|---|
| `/world-notes-seeder` | pre | **New.** Intake handwritten/raw world notes and seed the `world/` memory system — run *before* the outline goes in, so the whole pipeline starts with background knowledge. |
| `/outline-enhancer` | 0 | The dramaturg. Deepens a human sketch into an enriched outline (OB-NNN beats) and seeds/augments `world/` characters, threads, and arcs. |
| `/story-arc-reviewer` | 0.5 | The arc gate. Turns proposed arcs into confirmation questions (AQ-NNN) for the author, records answers as canon, emits the validated outline. |
| `/manuscript-planner` | 1 | Converts the validated outline into a writer-ready generation guide: chapter targets, scene briefs, thread beats. |
| `/manuscript-writer` | 2 | The writer — drafts/edits per the plan, deciding Implement / Push back / Suggest-only per item. |

## Revision half — draft → clean manuscript

| Command | What it does |
|---|---|
| `/book-reviewer` | The lector (v1). Manuscript, chapter, continuity, and motif review with severity-labeled findings. |
| `/book-reviewer-v2` | Enhanced lector — stable RV-NNN IDs, `world/` awareness, delta-review and sign-off modes. |
| `/manuscript-editing-planner` | Turns a review into a structured editing plan (v1). |
| `/manuscript-editing-planner-v2` | Enhanced planner — EP-NNN items, dependency graph, conflict detection, risk register. |
| `/manuscript-writer-v2` | Enhanced writer — voice fingerprint, precedent ledger, self-diff voice gate before commit. |
| `/chapter-title-cleanup` | Audits, renumbers, and standardizes chapter titles and filenames. Never touches prose. |

## Output — manuscript → hand-off

| Command | What it does |
|---|---|
| `/novel-formatting` | Cleans and standardizes the manuscript files into novel-ready text. |
| `/audiobook-text-prep-chunker` | Chunks the formatted text into TTS-ready segments + manifest — the contract the audiobook repos consume. |

## Notes

- **Passing instructions:** anything you type after the command becomes the request, e.g. `/book-reviewer-v2 chapters 20–25 only, delta against the June review`.
- **Personal vs. project commands:** you may also have personal commands in `~/.claude/commands/` on a given machine. Those are yours, on that machine only. The ones in this repo travel with the repo; if a name exists in both places, Claude Code shows both, labeled by source.
- **Typing a plain request** (e.g. just asking "review chapters 20–25") also works — Claude picks the right skill from your words. The commands exist so you don't have to remember what's available: type `/` and browse.
