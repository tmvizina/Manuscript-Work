import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { DB } from "../db/db.js";
import { nowIso } from "../db/db.js";
import { rootValue } from "../content/common.js";
import { BOOK_ROOTS } from "../content/chapters.js";
import { isPathInside, toPosixRelative } from "../content/paths.js";
import type { TrustedProjectRecord } from "../content/projectChapters.js";
import { deleteRagChunksForFile, deleteRagFile, getRagFileMetadata, listRagFileIds, upsertRagFile } from "./store.js";

/**
 * Corpus discovery and chunking for the native RAG index (design §4). Mirrors
 * `rag/raglib.py`'s `corpus_files`/`chunk_file` exactly (ported by hand, cross-
 * checked against the Python output — see corpus.chunker.parity.test.ts) and
 * reuses this repo's existing path-containment primitives rather than
 * reimplementing them. Nothing in this file touches an embedding model.
 */

/** Soft per-chunk character cap, matching `raglib.py`'s CHUNK_CHARS. */
export const RAG_CHUNK_CHARS = 1200;
/** Paragraphs of overlap carried into the next chunk, matching OVERLAP_PARAS. */
export const RAG_OVERLAP_PARAGRAPHS = 1;

/** Extensions treated as heading-aware Markdown-like content by the chunker
 * (mirrors raglib.py's `is_md` check) and as the world/ discovery filter. */
const MARKDOWN_LIKE_EXTENSIONS = new Set([".md", ".json"]);
/** Extensions collected under a `chapters` directory. */
const CHAPTER_EXTENSIONS = new Set([".txt", ".md"]);
/** Directory names never descended into, matching raglib.py's corpus_files exclusion. */
const EXCLUDED_DIR_NAMES = new Set(["node_modules", "dist"]);

function isExcludedDirName(name: string): boolean {
  return name.startsWith(".") || EXCLUDED_DIR_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Chunker (pure; no filesystem, no DB, no model)
// ---------------------------------------------------------------------------

/** Sentence-boundary fallback for a paragraph that alone exceeds the soft cap. */
function splitLongParagraph(paragraph: string, limit: number): string[] {
  if (paragraph.length <= limit) return [paragraph];
  // Split after a sentence-ending punctuation mark followed by whitespace,
  // never mid-sentence, matching raglib.py's _split_long exactly.
  const sentences = paragraph.split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const sentence of sentences) {
    if (cur && cur.length + sentence.length + 1 > limit) {
      out.push(cur);
      cur = sentence;
    } else {
      cur = `${cur} ${sentence}`.trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Blank-line paragraph split, with oversize paragraphs pre-split by sentence. */
function splitParagraphs(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const out: string[] = [];
  for (const paragraph of paragraphs) out.push(...splitLongParagraph(paragraph, RAG_CHUNK_CHARS));
  return out;
}

const HEADING_RE = /^(#{1,6})\s+(.*)/;

interface RagChunkGroup {
  heading: string;
  paragraphs: string[];
}

/**
 * Group already-split paragraphs into chunks, matching raglib.py's chunk_file
 * loop precisely: Markdown headings start a new group and stick to it until
 * the next heading; non-heading paragraphs pack into the current group until
 * the soft cap is exceeded, at which point the group closes and the last
 * `RAG_OVERLAP_PARAGRAPHS` paragraphs of it carry into the next group. The
 * `size` bookkeeping intentionally counts paragraph lengths only (it ignores
 * the "\n\n" join separators, same as the Python original) — a deliberate
 * bug-for-bug match, not an oversight.
 */
function groupParagraphs(paragraphs: readonly string[], isMarkdown: boolean): RagChunkGroup[] {
  const groups: RagChunkGroup[] = [];
  let heading = "";
  let buf: string[] = [];
  let size = 0;

  for (const paragraph of paragraphs) {
    const match = isMarkdown ? HEADING_RE.exec(paragraph) : null;
    if (match) {
      if (buf.length > 0) groups.push({ heading, paragraphs: buf });
      heading = match[2].trim();
      buf = [paragraph];
      size = paragraph.length;
      continue;
    }

    if (buf.length > 0 && size + paragraph.length > RAG_CHUNK_CHARS) {
      groups.push({ heading, paragraphs: buf });
      const tail = RAG_OVERLAP_PARAGRAPHS > 0 ? buf.slice(-RAG_OVERLAP_PARAGRAPHS) : [];
      buf = [...tail, paragraph];
      size = buf.reduce((sum, p) => sum + p.length, 0);
    } else {
      buf.push(paragraph);
      size += paragraph.length;
    }
  }
  if (buf.length > 0) groups.push({ heading, paragraphs: buf });
  return groups;
}

export interface RagChunkDraft {
  chunkIndex: number;
  heading: string;
  text: string;
  charCount: number;
}

/** Chunk one file's full text. `isMarkdown` gates heading-awareness, matching raglib.py's `is_md`. */
export function chunkText(text: string, isMarkdown: boolean): RagChunkDraft[] {
  const groups = groupParagraphs(splitParagraphs(text), isMarkdown);
  return groups.map((group, chunkIndex) => {
    const chunkedText = group.paragraphs.join("\n\n");
    return { chunkIndex, heading: group.heading, text: chunkedText, charCount: chunkedText.length };
  });
}

function isMarkdownLike(relPath: string): boolean {
  return MARKDOWN_LIKE_EXTENSIONS.has(extname(relPath).toLowerCase());
}

export interface RagChunkRecord extends RagChunkDraft {
  chunkId: string;
  fileId: string;
  relPath: string;
  book: string;
}

/** Chunk a hydrated corpus file and attach its id/book/rel_path, matching raglib.py's `chunk_file` output shape. */
export function chunkRagFile(file: { fileId: string; relPath: string; book: string; text: string }): RagChunkRecord[] {
  return chunkText(file.text, isMarkdownLike(file.relPath)).map((draft) => ({
    ...draft,
    chunkId: `${file.fileId}::${draft.chunkIndex}`,
    fileId: file.fileId,
    relPath: file.relPath,
    book: file.book,
  }));
}

// ---------------------------------------------------------------------------
// Corpus discovery (filesystem only; no DB, no model)
// ---------------------------------------------------------------------------

function hashRelPath(relPath: string): string {
  return createHash("sha256").update(relPath).digest("hex");
}

interface DiscoveredFile {
  absPath: string;
  relPath: string;
}

/**
 * Recursively collect files with an allowed extension under `startDir`,
 * refusing to follow any symlinked file or directory along the way. Mirrors
 * the lstat-then-realpath idiom `content/world.ts` and `search/index.ts`
 * already use for the same reason: a symlink here could make a project index
 * files physically outside its registered root.
 */
function collectFilesUnder(projectRoot: string, startDir: string, extensions: ReadonlySet<string>): DiscoveredFile[] {
  const out: DiscoveredFile[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      let lexicalStat;
      try {
        lexicalStat = lstatSync(full);
      } catch {
        continue;
      }
      if (lexicalStat.isSymbolicLink()) continue;

      if (lexicalStat.isDirectory()) {
        if (isExcludedDirName(name)) continue;
        let real: string;
        try {
          real = realpathSync(full);
        } catch {
          continue;
        }
        if (!isPathInside(projectRoot, real, false)) continue;
        walk(real);
        continue;
      }

      if (!lexicalStat.isFile()) continue;
      if (!extensions.has(extname(name).toLowerCase())) continue;
      let real: string;
      try {
        real = realpathSync(full);
      } catch {
        continue;
      }
      if (!isPathInside(projectRoot, real, false)) continue;
      out.push({ absPath: real, relPath: toPosixRelative(projectRoot, real) });
    }
  };
  walk(startDir);
  return out;
}

/** Resolve `<projectRoot>/world` the same defensive way `content/world.ts`'s `safeWorldRoot` does. */
function findWorldRoot(projectRoot: string): string | null {
  const root = join(projectRoot, "world");
  if (!existsSync(root)) return null;
  let lexicalStat;
  try {
    lexicalStat = lstatSync(root);
  } catch {
    return null;
  }
  if (!lexicalStat.isDirectory() || lexicalStat.isSymbolicLink()) return null;
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return null;
  }
  return isPathInside(projectRoot, real, false) ? real : null;
}

/**
 * Find every directory literally named "chapters" anywhere under the project
 * root, skipping hidden directories and node_modules/dist subtrees, matching
 * raglib.py's `corpus_files` (a recursive glob for directories named
 * "chapters" anywhere in the tree, with the same exclusion). Symlinked
 * directories are never followed.
 */
function findChapterRoots(projectRoot: string): string[] {
  const roots: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      let lexicalStat;
      try {
        lexicalStat = lstatSync(full);
      } catch {
        continue;
      }
      if (lexicalStat.isSymbolicLink() || !lexicalStat.isDirectory()) continue;
      if (isExcludedDirName(name)) continue;
      let real: string;
      try {
        real = realpathSync(full);
      } catch {
        continue;
      }
      if (!isPathInside(projectRoot, real, false)) continue;
      if (name === "chapters") roots.push(real);
      walk(real);
    }
  };
  walk(projectRoot);
  return roots;
}

/**
 * Label a chapters root for display alongside a retrieval result.
 *
 * raglib.py derived these from directory names ("book" for top-level
 * `chapters/`, "prequel-novella" for the novella). Those labels are not
 * reproduced here: the Python index was a standalone service whose labels were
 * never shown next to anything else, whereas these rows now sit in the same
 * database and the same UI as `project_chapters`, whose labels come from
 * BOOK_ROOTS ("book-1", "prequel"). Two names for one chapter is a defect the
 * reader would see, and label text has no bearing on retrieval quality.
 *
 * Known roots therefore take their canonical BOOK_ROOTS label. Discovery still
 * accepts a `chapters` directory at any depth, so anything outside that fixed
 * set falls back to its parent directory name.
 */
function chapterBookName(projectRoot: string, chapterRoot: string): string {
  const rel = toPosixRelative(projectRoot, chapterRoot);
  const canonical = BOOK_ROOTS.find((entry) => entry.dir.split(sep).join("/") === rel);
  if (canonical) return canonical.book;
  const slash = rel.lastIndexOf("/");
  return slash >= 0 ? rel.slice(0, slash) : rel;
}

function lexicalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface RagCorpusFileMetadata {
  /** Stable sha256(rel_path) surrogate key, independent of filesystem identity. */
  fileId: string;
  relPath: string;
  book: string;
  /** Absolute source path. */
  path: string;
  fileMtime: string;
  fileSize: number;
}

/**
 * Scan `world/` and every `chapters` directory (at any depth) under a trusted
 * project root, returning metadata only (no file contents read). Mirrors
 * `raglib.py::corpus_files`'s roots and book naming exactly.
 */
export function scanRagCorpusFiles(rootPath: string): RagCorpusFileMetadata[] {
  const root = rootValue(rootPath, "projectRoot");
  if (!existsSync(root)) return [];
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];

  const specs: Array<{ book: string; root: string; extensions: ReadonlySet<string> }> = [];
  const worldRoot = findWorldRoot(root);
  if (worldRoot) specs.push({ book: "world", root: worldRoot, extensions: MARKDOWN_LIKE_EXTENSIONS });

  const chapterSpecs = findChapterRoots(root)
    .map((chapterRoot) => ({ book: chapterBookName(root, chapterRoot), root: chapterRoot, extensions: CHAPTER_EXTENSIONS }))
    .sort((a, b) => lexicalCompare(toPosixRelative(root, a.root), toPosixRelative(root, b.root)));
  specs.push(...chapterSpecs);

  const files: RagCorpusFileMetadata[] = [];
  for (const spec of specs) {
    const found = collectFilesUnder(root, spec.root, spec.extensions).sort((a, b) => lexicalCompare(a.relPath, b.relPath));
    for (const file of found) {
      const stat = statSync(file.absPath);
      files.push({
        fileId: hashRelPath(file.relPath),
        relPath: file.relPath,
        book: spec.book,
        path: file.absPath,
        fileMtime: stat.mtime.toISOString(),
        fileSize: stat.size,
      });
    }
  }
  return files;
}

export interface RagCorpusFile extends RagCorpusFileMetadata {
  text: string;
  contentSha256: string;
}

/** Read one scanned file's content and content hash. */
export function readRagCorpusFile(file: RagCorpusFileMetadata): RagCorpusFile {
  const text = readFileSync(file.path, "utf-8");
  return { ...file, text, contentSha256: createHash("sha256").update(text).digest("hex") };
}

// ---------------------------------------------------------------------------
// DB-backed file sync (metadata cache only — never writes chunk/vector rows,
// since a vector requires an embedding model this ticket deliberately excludes)
// ---------------------------------------------------------------------------

export interface RagFileSyncResult {
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
}

function trustedRagProject(project: TrustedProjectRecord): TrustedProjectRecord {
  if (!project || typeof project !== "object") {
    throw new TypeError("A trusted project record is required for RAG corpus sync");
  }
  if (typeof project.projectId !== "string" || project.projectId.length === 0 || project.projectId.includes("\0")) {
    throw new TypeError("Trusted project is missing a valid projectId");
  }
  if (typeof project.rootPath !== "string" || project.rootPath.trim().length === 0 || project.rootPath.includes("\0")) {
    throw new TypeError("Trusted project is missing a valid rootPath");
  }
  return { projectId: project.projectId, rootPath: resolve(project.rootPath) };
}

/**
 * Synchronize `project_rag_files` with the current corpus: added/changed
 * files get their metadata (and content hash) refreshed and their stale
 * chunks cleared; unchanged files are skipped without a read, using the same
 * `file_size >= 0 && file_size === … && file_mtime === …` fast path
 * migration 2 established for `project_chapters`; vanished files are deleted
 * outright (their chunk rows cascade via the FK — no soft-deactivate, RAG has
 * no "show deactivated" UI requirement).
 *
 * This function deliberately stops at the file-cache layer: it never embeds
 * or inserts a chunk/vector row, since doing so needs a real embedding model
 * (out of this ticket's model-free scope). A later indexing pass calls
 * `chunkRagFile` + `store.ts`'s `replaceRagFileChunks` for whichever files
 * this sync reports as added/updated.
 */
export function syncRagCorpusFiles(db: DB, project: TrustedProjectRecord): RagFileSyncResult {
  const trusted = trustedRagProject(project);
  const files = scanRagCorpusFiles(trusted.rootPath);
  const result: RagFileSyncResult = { scanned: files.length, added: 0, updated: 0, unchanged: 0, deleted: 0 };
  const seen = new Set<string>();
  const indexedAt = nowIso();

  for (const file of files) {
    seen.add(file.fileId);
    const previous = getRagFileMetadata(db, trusted.projectId, file.fileId);
    const metadataUnchanged =
      previous !== null && previous.fileSize >= 0 && previous.fileSize === file.fileSize && previous.fileMtime === file.fileMtime;
    if (metadataUnchanged) {
      result.unchanged++;
      continue;
    }

    const hydrated = readRagCorpusFile(file);
    // The file's text changed (or it's new); any existing chunks describe
    // stale text and must go before the cache row is refreshed, so a partial
    // reindex can never pair old vectors with new chunk text.
    deleteRagChunksForFile(db, trusted.projectId, file.fileId);
    upsertRagFile(db, trusted.projectId, {
      fileId: hydrated.fileId,
      relPath: hydrated.relPath,
      book: hydrated.book,
      fileMtime: hydrated.fileMtime,
      fileSize: hydrated.fileSize,
      contentSha256: hydrated.contentSha256,
      indexedAt,
    });
    if (previous) result.updated++;
    else result.added++;
  }

  for (const fileId of listRagFileIds(db, trusted.projectId)) {
    if (!seen.has(fileId)) {
      deleteRagFile(db, trusted.projectId, fileId);
      result.deleted++;
    }
  }

  return result;
}
