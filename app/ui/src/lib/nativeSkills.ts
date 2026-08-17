import type { SkillSummary } from "./api";
import type { ProjectProfileConfig } from "../transport";

type Phase = "intake" | "generation" | "revision" | "output" | "archived";
const definitions: Array<[string, string, number, Phase, string]> = [
  ["world-notes-seeder", "World Notes Seeder", 1, "intake", "Ingest notes and source material into the project's memory system."],
  ["outline-enhancer", "Outline Enhancer", 2, "generation", "Deepen an initial concept into a structured, memory-backed outline."],
  ["story-arc-reviewer", "Story Arc Reviewer", 3, "generation", "Run the human checkpoint for structure, coverage, and unresolved decisions."],
  ["manuscript-planner", "Manuscript Planner", 4, "generation", "Turn a validated outline into writer-ready chapter briefs and dependencies."],
  ["book-reviewer-v2", "Book Reviewer v2", 5, "revision", "Review the manuscript with stable findings, memory, and voice protection."],
  ["manuscript-editing-planner-v2", "Editing Planner v2", 6, "revision", "Turn review findings into dependency-aware editing work."],
  ["manuscript-writer-v2", "Manuscript Writer v2", 7, "revision", "Draft or revise while protecting voice and provenance."],
  ["chapter-title-cleanup", "Chapter Title Cleanup", 8, "output", "Audit and standardize titles and filenames without rewriting prose."],
  ["novel-formatting", "Novel Formatting", 9, "output", "Format fiction or nonfiction consistently while preserving prose."],
  ["audiobook-text-prep-chunker", "Audiobook Chunker", 10, "output", "Split the finished manuscript into sentence-safe TTS chunks."],
  ["book-reviewer", "Book Reviewer", 11, "archived", "Lightweight v1 manuscript review."],
  ["manuscript-editing-planner", "Editing Planner", 12, "archived", "Lightweight v1 editing planner."],
  ["manuscript-writer", "Manuscript Writer", 13, "archived", "Lightweight v1 drafting and revision workflow."],
];

const nonfiction: Record<string, [string, string]> = {
  "world-notes-seeder": ["Knowledge Intake", "Ingest field notes, interviews, photographs, firsthand observations, and research without inventing experiences or claims."],
  "outline-enhancer": ["Content Architecture Enhancer", "Develop the reader promise, topic progression, instructional coverage, and placement of personal fishing stories."],
  "story-arc-reviewer": ["Structure & Coverage Gate", "Confirm audience, organization, omissions, instructional sequence, and anecdote placement."],
  "manuscript-planner": ["Nonfiction Manuscript Planner", "Build chapter briefs with learning goals, prerequisites, demonstrations, stories, and safety callouts."],
  "book-reviewer-v2": ["Nonfiction Reviewer v2", "Review usefulness, factual boundaries, safety, structure, provenance, and voice."],
  "manuscript-editing-planner-v2": ["Nonfiction Editing Planner v2", "Turn nonfiction findings into traceable, dependency-aware editing work."],
  "manuscript-writer-v2": ["Nonfiction Writer v2", "Draft practical narrative nonfiction while distinguishing lived experience from general advice."],
  "novel-formatting": ["Manuscript Formatting", "Apply consistent book formatting without assuming the manuscript is a novel."],
};

export const NATIVE_PHASE_LABELS: Record<string, string> = { intake: "Intake", generation: "Generation", revision: "Revision", output: "Output", archived: "Archived" };

export function nativeSkills(profile?: ProjectProfileConfig): SkillSummary[] {
  return definitions.map(([skill_id, defaultName, pipeline_order, phase, defaultBlurb]) => {
    const override = profile?.profile === "nonfiction" ? nonfiction[skill_id] : undefined;
    return {
      skill_id,
      display_name: override?.[0] ?? defaultName,
      pipeline_order,
      phase,
      blurb: override?.[1] ?? defaultBlurb,
      image_path: `/skill-art/${skill_id}.svg`,
      has_rag_variant: 1,
    };
  });
}
