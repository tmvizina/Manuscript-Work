import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The bundled guide library.
 *
 * These are first-party documents shipped with the application, not project
 * content, so they are read from the packaged resources directory rather than
 * from a manuscript root. The slug list is fixed here rather than discovered by
 * scanning, so a stray file dropped into the guides directory can never become
 * a readable section.
 */
export interface HelpSectionDefinition {
  slug: string;
  title: string;
  blurb: string;
  /** File name inside the guides resource directory. */
  fileName: string;
  /** Markdown is rendered by the renderer; HTML pages are self-styled. */
  format: "markdown" | "html";
}

/** Order is reading order, matching the compatibility server's help index. */
export const HELP_SECTIONS: readonly HelpSectionDefinition[] = Object.freeze([
  {
    slug: "commands",
    title: "Command Reference",
    blurb: "Every skill mapped to its slash command, in pipeline order — generation half, revision half, and output.",
    fileName: "commands-reference.md",
    format: "markdown",
  },
  {
    slug: "workflow",
    title: "Workflow Map",
    blurb: "The full book-generation workflow as a visual map — how a sketch becomes a chunked manuscript.",
    fileName: "workflow.html",
    format: "html",
  },
  {
    slug: "nonfiction",
    title: "Nonfiction & the Knowledge Base",
    blurb: "How a practical nonfiction project differs from fiction — attributed experience, dated safety claims, and the Knowledge Base layout.",
    fileName: "nonfiction-knowledge-base.md",
    format: "markdown",
  },
  {
    slug: "syncing",
    title: "Syncing Skills & Commands",
    blurb: "The three places skills live and the everyday recipes for keeping machines in sync.",
    fileName: "syncing-skills-and-commands.md",
    format: "markdown",
  },
  {
    slug: "creating",
    title: "Creating Your Own Skills",
    blurb: "When to make a skill, the anatomy of one, and step-by-step instructions shaped to this pipeline.",
    fileName: "creating-your-own-skills.md",
    format: "markdown",
  },
  {
    slug: "git",
    title: "Git in JetBrains",
    blurb: "A beginner's guide to git inside Rider — the daily routine, branches, history, and fixing mistakes.",
    fileName: "git-in-jetbrains-for-beginners.md",
    format: "markdown",
  },
  {
    slug: "bridge",
    title: "Claude Bridge",
    blurb: "How to run claude in an IDE terminal so this app can reach it — required before the Run buttons work.",
    fileName: "claude-bridge.md",
    format: "markdown",
  },
  {
    slug: "rag",
    title: "RAG Overview",
    blurb: "What the canon RAG is, how retrieval works, and why it saves tokens over whole-file pulls.",
    fileName: "rag-overview.md",
    format: "markdown",
  },
  {
    slug: "rag-maint",
    title: "Maintaining & Embedding the RAG",
    blurb: "When and how to rebuild the index, pointing it at your manuscript, and the version-pinning rules.",
    fileName: "rag-maintenance.md",
    format: "markdown",
  },
] as const);

export const HELP_RESOURCE_DIRECTORY = "guides";

/** Largest guide this will serve; the bundled set is far below it. */
const MAX_GUIDE_BYTES = 2 * 1024 * 1024;

export interface HelpGuideReaderOptions {
  /** Overridden in tests and in development, where resources are not packaged. */
  guidesRoot?: string;
}

export function resolveGuidesRoot(resourcesPath: string, options: HelpGuideReaderOptions = {}): string {
  return options.guidesRoot ? resolve(options.guidesRoot) : join(resolve(resourcesPath), HELP_RESOURCE_DIRECTORY);
}

export function findHelpSection(slug: string): HelpSectionDefinition | undefined {
  return HELP_SECTIONS.find((section) => section.slug === slug);
}

export interface HelpGuideContent {
  slug: string;
  title: string;
  format: "markdown" | "html";
  text: string;
}

/**
 * Read one guide by slug. The file name comes from the fixed table above and
 * never from the caller, so no path segment supplied by a renderer reaches the
 * filesystem; the containment check is defence in depth for a bad table entry.
 */
export function readHelpGuide(guidesRoot: string, slug: string): HelpGuideContent | null {
  const section = findHelpSection(slug);
  if (!section) return null;

  const root = resolve(guidesRoot);
  const filePath = join(root, section.fileName);
  if (!filePath.startsWith(root)) return null;
  if (!existsSync(filePath)) return null;

  // A symlinked guide could point outside the bundle; refuse rather than follow.
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) return null;
  if (statSync(filePath).size > MAX_GUIDE_BYTES) return null;

  return {
    slug: section.slug,
    title: section.title,
    format: section.format,
    text: readFileSync(filePath, "utf-8"),
  };
}

/** List the sections whose files are actually present in this build. */
export function listHelpSections(guidesRoot: string): Array<HelpSectionDefinition & { available: boolean }> {
  const root = resolve(guidesRoot);
  return HELP_SECTIONS.map((section) => ({
    ...section,
    available: existsSync(join(root, section.fileName)),
  }));
}
