import { existsSync, readFileSync, statSync } from "node:fs";
import { safeRepoPath } from "./paths.js";

export interface HelpSectionDefinition {
  slug: string;
  title: string;
  blurb: string;
  /** Relative to repoRoot, or an already-resolved path beneath repoRoot. */
  mdFile: string | null;
  externalPath?: string;
}

export interface HelpSectionSummary {
  slug: string;
  title: string;
  blurb: string;
  external: string | null;
}

export interface HelpDocument {
  slug: string;
  title: string;
  markdown: string;
  path: string;
  mtime: string;
  bytes: number;
}

export function listHelpSections(
  _repoRoot: string,
  sections: readonly HelpSectionDefinition[],
): HelpSectionSummary[] {
  return sections.map(({ slug, title, blurb, externalPath }) => ({
    slug,
    title,
    blurb,
    external: externalPath ?? null,
  }));
}

export function findHelpSection(
  sections: readonly HelpSectionDefinition[],
  slug: string,
): HelpSectionDefinition | undefined {
  return sections.find((section) => section.slug === slug);
}

/** Resolve and read a markdown help section. Null means unknown, external, or
 * missing; route layers can translate that into their existing 404 response. */
export function readHelpSection(
  repoRoot: string,
  sections: readonly HelpSectionDefinition[],
  slug: string,
): HelpDocument | null {
  const section = findHelpSection(sections, slug);
  if (!section?.mdFile) return null;
  const path = safeRepoPath(repoRoot, section.mdFile);
  if (!path || !existsSync(path) || !statSync(path).isFile()) return null;
  const stat = statSync(path);
  return {
    slug: section.slug,
    title: section.title,
    markdown: readFileSync(path, "utf-8"),
    path,
    mtime: stat.mtime.toISOString(),
    bytes: stat.size,
  };
}

/** Read a repository-owned standalone page such as docs/guides/workflow.html. */
export function readRepoContent(repoRoot: string, relPath: string): { path: string; text: string } | null {
  const path = safeRepoPath(repoRoot, relPath);
  if (!path || !existsSync(path) || !statSync(path).isFile()) return null;
  return { path, text: readFileSync(path, "utf-8") };
}
