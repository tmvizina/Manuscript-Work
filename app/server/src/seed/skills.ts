/** The sidebar's source of truth: pipeline order, phase grouping, curated
 * blurbs, and emblem art per skill. Frontmatter description/argument-hint are
 * synced from SKILL.md at boot (skillSync.ts) — this file owns everything else. */

export interface SkillSeed {
  skill_id: string;
  display_name: string;
  pipeline_order: number;
  phase: "intake" | "generation" | "revision" | "output" | "archived";
  blurb: string;
}

/** Extra sidebar placements: the same skill linked into a second phase.
 * The v2 writer lives in Revision but also generates the first draft, so it
 * is linked into Generation too. */
export const SIDEBAR_ALIASES: Array<{ skill_id: string; phase: SkillSeed["phase"]; pipeline_order: number }> = [
  { skill_id: "manuscript-writer-v2", phase: "generation", pipeline_order: 4.5 },
];

export const SKILL_SEED: SkillSeed[] = [
  {
    skill_id: "world-notes-seeder",
    display_name: "World Notes Seeder",
    pipeline_order: 1,
    phase: "intake",
    blurb:
      "The canon intake clerk. Ingests rough notes, transcripts, and photos into the world/ memory system with stable CHAR/THR/ARC IDs — the fact base every later stage reads.",
  },
  {
    skill_id: "outline-enhancer",
    display_name: "Outline Enhancer",
    pipeline_order: 2,
    phase: "generation",
    blurb:
      "The dramaturg. Deepens a human sketch — a premise, outline, or beat sheet — into an enriched outline, seeding world/ with opening characters, threads, and arcs.",
  },
  {
    skill_id: "story-arc-reviewer",
    display_name: "Story Arc Reviewer",
    pipeline_order: 3,
    phase: "generation",
    blurb:
      "The arc gate — a deliberate human checkpoint. Turns proposed arcs and open questions into confirmation questions, records your answers as canon, and hands down a validated outline.",
  },
  {
    skill_id: "manuscript-planner",
    display_name: "Manuscript Planner",
    pipeline_order: 4,
    phase: "generation",
    blurb:
      "The generation planner. Converts the validated outline into a writer-ready generation guide: chapter targets, scene briefs, per-chapter thread beats, and voice anchors.",
  },
  {
    skill_id: "book-reviewer-v2",
    display_name: "Book Reviewer v2",
    pipeline_order: 5,
    phase: "revision",
    blurb:
      "The enhanced lector. Stable RV-NNN finding IDs, world/ memory integration, protected voice signatures, and delta-review / sign-off modes that don't re-flag resolved issues.",
  },
  {
    skill_id: "manuscript-editing-planner-v2",
    display_name: "Editing Planner v2",
    pipeline_order: 6,
    phase: "revision",
    blurb:
      "The enhanced planner. EP-NNN plan items that reference RV-NNN findings, a dependency graph, conflict detection, a risk register, and S/M/L/XL effort estimates.",
  },
  {
    skill_id: "manuscript-writer-v2",
    display_name: "Manuscript Writer v2",
    pipeline_order: 7,
    phase: "revision",
    blurb:
      "The writer. Generates the first draft from the generation guide and executes editing plans on revision passes — with a voice fingerprint, precedent ledger, proactive findings, and a self-diff voice gate that demotes drifting edits before commit.",
  },
  {
    skill_id: "chapter-title-cleanup",
    display_name: "Chapter Title Cleanup",
    pipeline_order: 8,
    phase: "output",
    blurb:
      "Audits, renumbers, and standardizes chapter, part, and file titles without touching prose. Produces a title audit and a rename map.",
  },
  {
    skill_id: "novel-formatting",
    display_name: "Novel Formatting",
    pipeline_order: 9,
    phase: "output",
    blurb:
      "Formats chapter files into clean, novel-ready text — consistent headings, scene breaks, and paragraph spacing. Preserves the prose and chapter order untouched.",
  },
  {
    skill_id: "audiobook-text-prep-chunker",
    display_name: "Audiobook Chunker",
    pipeline_order: 10,
    phase: "output",
    blurb:
      "The hand-off step. Splits finished chapters into TTS-ready chunks (~1500–1800 chars, never splitting a sentence) plus the chunk manifest the audiobook repos consume.",
  },
  // ---- Archived: the v1 skills. The v2s are superior; v1s stay runnable and
  // are lighter on tokens for quick, low-stakes passes. ----
  {
    skill_id: "book-reviewer",
    display_name: "Book Reviewer",
    pipeline_order: 11,
    phase: "archived",
    blurb:
      "The lector (v1) — archived in favor of Book Reviewer v2. Still runnable and cheaper per pass; fine for a quick one-off review with no prior review context.",
  },
  {
    skill_id: "manuscript-editing-planner",
    display_name: "Editing Planner",
    pipeline_order: 12,
    phase: "archived",
    blurb:
      "The v1 planner — archived in favor of Editing Planner v2. Lighter on tokens for a simple single-chapter plan; lacks v2's stable IDs, dependency graph, and conflict detection.",
  },
  {
    skill_id: "manuscript-writer",
    display_name: "Manuscript Writer",
    pipeline_order: 13,
    phase: "archived",
    blurb:
      "The v1 writer — archived in favor of Manuscript Writer v2. Cheaper per pass, but without the voice fingerprint, precedent ledger, and self-diff voice gate.",
  },
];

export const PHASE_LABELS: Record<SkillSeed["phase"], string> = {
  intake: "Intake",
  generation: "Generation",
  revision: "Revision",
  output: "Output",
  archived: "Archived",
};
