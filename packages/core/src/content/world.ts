import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { rootValue } from "./common.js";
import { isPathInside, safeWorldPath, toPosixRelative } from "./paths.js";

const WORLD_EXTENSIONS = new Set([".md", ".json"]);

export interface WorldFile {
  rel_path: string;
  name: string;
  ext: string;
}

export interface WorldScanResult {
  exists: boolean;
  groups: Array<{ dir: string; files: WorldFile[] }>;
}

export interface WorldDocument {
  rel_path: string;
  path: string;
  mtime: string;
  bytes: number;
  kind: "md" | "json";
  raw: string;
  text: string;
}

function projectRootValue(projectRoot: string): string {
  return rootValue(projectRoot, "projectRoot");
}

function safeWorldRoot(projectRoot: string): string | null {
  const project = projectRootValue(projectRoot);
  if (!existsSync(project)) return null;
  const projectStat = lstatSync(project);
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) return null;
  const root = join(project, "world");
  if (!existsSync(root)) return null;
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  const realRoot = realpathSync(root);
  return isPathInside(realpathSync(project), realRoot, false) ? realRoot : null;
}

/** Scan markdown/JSON files below projectRoot/world, grouped by subdirectory. */
export function scanWorld(projectRoot: string): Map<string, WorldFile[]> {
  const root = safeWorldRoot(projectRoot);
  const groups = new Map<string, WorldFile[]>();
  if (!root) return groups;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const lexicalStat = lstatSync(full);
      if (lexicalStat.isSymbolicLink()) continue;
      const real = realpathSync(full);
      if (!isPathInside(root, real, false)) continue;
      const stat = statSync(real);
      if (stat.isDirectory()) {
        walk(real);
        continue;
      }
      const dot = entry.lastIndexOf(".");
      const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : "";
      if (!WORLD_EXTENSIONS.has(ext)) continue;
      const relPath = toPosixRelative(root, real);
      const group = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
      const files = groups.get(group) ?? [];
      files.push({ rel_path: relPath, name: entry.slice(0, dot), ext });
      groups.set(group, files);
    }
  };
  walk(root);
  return groups;
}

export function listWorld(projectRoot: string): WorldScanResult {
  const groups = scanWorld(projectRoot);
  return {
    exists: safeWorldRoot(projectRoot) !== null,
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, files]) => ({ dir, files })),
  };
}

/** Read one world file after resolving it through the traversal-safe helper. */
export function readWorldFile(projectRoot: string, relPath: string): WorldDocument | null {
  const project = projectRootValue(projectRoot);
  const root = safeWorldRoot(project);
  const candidate = safeWorldPath(project, relPath);
  if (!root || !candidate || !existsSync(candidate)) return null;
  const lexicalStat = lstatSync(candidate);
  if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile()) return null;
  const path = realpathSync(candidate);
  if (!isPathInside(root, path, false)) return null;
  const raw = readFileSync(path, "utf-8");
  const stat = statSync(path);
  const kind = relPath.toLowerCase().endsWith(".json") ? "json" : "md";
  let text = raw;
  if (kind === "json") {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // Preserve malformed JSON verbatim, matching the existing route.
    }
  }
  return {
    rel_path: relPath,
    path,
    mtime: stat.mtime.toISOString(),
    bytes: stat.size,
    kind,
    raw,
    text,
  };
}

/** Turn [[wikilinks]] into app links when a basename is known. */
export function linkifyWikiRefs(md: string, nameToPath: Map<string, string>): string {
  return md.replace(/\[\[([^\[\]]+)\]\]/g, (_match, raw: string) => {
    const token = String(raw).trim();
    const target = nameToPath.get(token.toLowerCase());
    if (target) return `[${token}](#/world/${encodeURI(target)})`;
    return `<span class="wiki-missing" title="No world file with this name yet">${token}</span>`;
  });
}
