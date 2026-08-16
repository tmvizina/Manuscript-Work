import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { rootValue } from "./common.js";
import { safeWorldPath, toPosixRelative } from "./paths.js";

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

/** Scan markdown/JSON files below projectRoot/world, grouped by subdirectory. */
export function scanWorld(projectRoot: string): Map<string, WorldFile[]> {
  const root = join(projectRootValue(projectRoot), "world");
  const groups = new Map<string, WorldFile[]>();
  if (!existsSync(root)) return groups;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const dot = entry.lastIndexOf(".");
      const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : "";
      if (!WORLD_EXTENSIONS.has(ext)) continue;
      const relPath = toPosixRelative(root, full);
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
    exists: existsSync(join(projectRootValue(projectRoot), "world")),
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, files]) => ({ dir, files })),
  };
}

/** Read one world file after resolving it through the traversal-safe helper. */
export function readWorldFile(projectRoot: string, relPath: string): WorldDocument | null {
  const path = safeWorldPath(projectRootValue(projectRoot), relPath);
  if (!path || !existsSync(path) || !statSync(path).isFile()) return null;
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
