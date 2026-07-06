import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { marked } from "marked";
import { MANUSCRIPT_ROOT } from "../config.js";

const WORLD_ROOT = join(MANUSCRIPT_ROOT, "world");
const EXTS = new Set([".md", ".json"]);

interface WorldFile {
  rel_path: string; // relative to world/, posix separators
  name: string; // filename without extension
  ext: string;
}

function scanWorld(): Map<string, WorldFile[]> {
  const groups = new Map<string, WorldFile[]>();
  if (!existsSync(WORLD_ROOT)) return groups;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      const dot = entry.lastIndexOf(".");
      const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : "";
      if (!EXTS.has(ext)) continue;
      const rel = relative(WORLD_ROOT, full).split(sep).join("/");
      const group = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const list = groups.get(group) ?? [];
      list.push({ rel_path: rel, name: entry.slice(0, dot), ext });
      groups.set(group, list);
    }
  };
  walk(WORLD_ROOT);
  return groups;
}

/** Resolve a requested path safely inside world/ (no traversal). */
function safeWorldPath(rel: string): string | null {
  const full = resolve(WORLD_ROOT, rel);
  if (full !== WORLD_ROOT && !full.startsWith(WORLD_ROOT + sep)) return null;
  return full;
}

/** Turn [[wikilinks]] into app links when the target matches a known file
 * basename; unknown targets become a styled "not yet written" span. */
function linkifyWikiRefs(md: string, nameToPath: Map<string, string>): string {
  return md.replace(/\[\[([^\[\]]+)\]\]/g, (_m, raw: string) => {
    const token = String(raw).trim();
    const target = nameToPath.get(token.toLowerCase());
    if (target) return `[${token}](#/world/${encodeURI(target)})`;
    return `<span class="wiki-missing" title="No world file with this name yet">${token}</span>`;
  });
}

export default function worldRoutes(app: FastifyInstance): void {
  app.get("/api/world", async () => {
    const groups = scanWorld();
    return {
      exists: existsSync(WORLD_ROOT),
      groups: [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dir, files]) => ({ dir, files })),
    };
  });

  app.get("/api/world/file", async (req, reply) => {
    const rel = String((req.query as { path?: string }).path ?? "");
    if (!rel) return reply.code(400).send({ error: "missing path" });
    const full = safeWorldPath(rel);
    if (!full || !existsSync(full) || !statSync(full).isFile()) {
      return reply.code(404).send({ error: "unknown world file" });
    }

    const raw = readFileSync(full, "utf-8");
    const st = statSync(full);
    const base = { rel_path: rel, mtime: st.mtime.toISOString(), bytes: st.size };

    if (rel.toLowerCase().endsWith(".json")) {
      let pretty = raw;
      try {
        pretty = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* show as-is if malformed */
      }
      return { ...base, kind: "json", text: pretty };
    }

    // Markdown: resolve [[wikilinks]] against every known world file basename.
    const nameToPath = new Map<string, string>();
    for (const files of scanWorld().values()) {
      for (const f of files) nameToPath.set(f.name.toLowerCase(), f.rel_path);
    }
    const html = await marked.parse(linkifyWikiRefs(raw, nameToPath));
    return { ...base, kind: "md", html };
  });
}
