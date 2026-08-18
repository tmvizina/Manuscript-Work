import { marked } from "marked";
import type { ReviewIdReference, WorldSummary } from "../transport";

/**
 * Markdown rendering for native documents.
 *
 * The desktop boundary returns source text rather than server-rendered HTML,
 * so rendering happens here. These are the user's own manuscript files, the
 * browser app already renders the same content, and the packaged CSP blocks
 * scripts, so presenting them as readable documents costs nothing that leaving
 * them as raw source was buying.
 */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}

/**
 * Map a world file's display name to its path, keyed lowercase.
 *
 * The compatibility server builds the same map from each file's basename
 * without extension, which is exactly what `title` carries for native world
 * summaries.
 */
export function buildWorldNameMap(documents: readonly WorldSummary[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const document of documents) {
    const name = document.title ?? basenameWithoutExtension(document.relPath);
    if (!name) continue;
    const key = name.toLowerCase();
    // First writer wins, matching the server's `if (!index.has(...))` ordering.
    if (!map.has(key)) map.set(key, document.relPath);
  }
  return map;
}

function basenameWithoutExtension(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Turn `[[wikilinks]]` into app links when the target names a known world
 * file; unknown targets become a styled "not yet written" marker rather than
 * a dead link, so missing canon is visible instead of silently plain text.
 *
 * Mirrors the compatibility server's linkifyWikiRefs. Kept here rather than
 * shared with it because the renderer cannot import the Node-side package;
 * markdown.test.ts pins the behaviours that must not drift.
 */
export function linkifyWikiRefs(source: string, nameToPath: Map<string, string>): string {
  return source.replace(/\[\[([^\[\]]+)\]\]/g, (_match, raw: string) => {
    const token = String(raw).trim();
    const target = nameToPath.get(token.toLowerCase());
    if (target) return `[${token}](#/world/${encodeURI(target)})`;
    return `<span class="wiki-missing" title="No world file with this name yet">${token}</span>`;
  });
}

/**
 * Link RV-/EP-/WP- pipeline ids in rendered review HTML to the document that
 * defines them, so the review to plan to rewrite chain stays clickable. An id
 * defined by the document being read is marked but not linked to itself.
 *
 * Mirrors linkifyReviewIds in @book-writer/core, which the main process uses
 * to build the index; pinned by markdown.test.ts.
 */
export function linkifyReviewIds(html: string, index: Map<string, string>, selfPath: string): string {
  return html.replace(/\b((?:RV|EP|WP)-[A-Za-z0-9-]*-?\d+)\b/g, (token) => {
    const target = index.get(token);
    if (target && target !== selfPath) return `<a class="ref-id" href="#/reviews/${encodeURI(target)}">${token}</a>`;
    return `<span class="ref-id">${token}</span>`;
  });
}

/** Render a review document with its pipeline ids resolved. */
export function renderReviewMarkdown(source: string, index: readonly ReviewIdReference[], selfPath: string): string {
  const map = new Map(index.map((entry) => [entry.id, entry.relPath]));
  return linkifyReviewIds(renderMarkdown(source), map, selfPath);
}

/** Render a world document with its cross-references resolved. */
export function renderWorldMarkdown(source: string, documents: readonly WorldSummary[]): string {
  return renderMarkdown(linkifyWikiRefs(source, buildWorldNameMap(documents)));
}
