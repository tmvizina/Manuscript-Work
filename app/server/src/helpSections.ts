import { join } from "node:path";
import { REPO_ROOT } from "./config.js";

export interface HelpSection {
  slug: string;
  title: string;
  blurb: string;
  /** Markdown source rendered by GET /api/help/:slug — or null for external pages. */
  mdFile: string | null;
  /** For self-styled pages served verbatim (opened in a new tab). */
  externalPath?: string;
}

/** The Help overview: each guide section is its own page so nobody has to
 * scroll one giant document. Order = reading order. */
export const HELP_SECTIONS: HelpSection[] = [
  {
    slug: "commands",
    title: "Command Reference",
    blurb: "Every skill mapped to its slash command, in pipeline order — generation half, revision half, and output.",
    mdFile: join(REPO_ROOT, "docs/guides/commands-reference.md"),
  },
  {
    slug: "workflow",
    title: "Workflow Map",
    blurb: "The full book-generation workflow as a visual map — how a sketch becomes a chunked manuscript.",
    mdFile: null,
    externalPath: "/help/workflow",
  },
  {
    slug: "syncing",
    title: "Syncing Skills & Commands",
    blurb: "The three places skills live and the everyday recipes for keeping machines in sync.",
    mdFile: join(REPO_ROOT, "docs/guides/syncing-skills-and-commands.md"),
  },
  {
    slug: "creating",
    title: "Creating Your Own Skills",
    blurb: "When to make a skill, the anatomy of one, and step-by-step instructions shaped to this pipeline.",
    mdFile: join(REPO_ROOT, "docs/guides/creating-your-own-skills.md"),
  },
  {
    slug: "git",
    title: "Git in JetBrains",
    blurb: "A beginner's guide to git inside Rider — the daily routine, branches, history, and fixing mistakes.",
    mdFile: join(REPO_ROOT, "docs/guides/git-in-jetbrains-for-beginners.md"),
  },
  {
    slug: "bridge",
    title: "Claude Bridge",
    blurb: "How to run claude in an IDE terminal so this app can reach it — required before the Run buttons work.",
    mdFile: join(REPO_ROOT, "docs/guides/claude-bridge.md"),
  },
  {
    slug: "rag",
    title: "RAG Overview",
    blurb: "What the canon RAG is, how retrieval works, and why it saves tokens over whole-file pulls.",
    mdFile: join(REPO_ROOT, "docs/guides/rag-overview.md"),
  },
  {
    slug: "rag-maint",
    title: "Maintaining & Embedding the RAG",
    blurb: "When and how to rebuild the index, pointing it at your manuscript, and the version-pinning rules.",
    mdFile: join(REPO_ROOT, "docs/guides/rag-maintenance.md"),
  },
];
