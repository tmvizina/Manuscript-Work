/** Visibility into the revision loop: lector review reports, editing plans,
 * and the writer's triage decisions. These are flat markdown/JSON files the
 * skills write under MANUSCRIPT_ROOT/reviews/ and MANUSCRIPT_ROOT/editing-plan/
 * (same disk-backed pattern as world.ts). Documents are classified by filename
 * convention, summarized with lightweight stat parsing (severity counts,
 * decision counts, sign-off verdicts), and RV-/EP-/WP- IDs are cross-linked
 * between documents when rendered. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { marked } from "marked";
import { MANUSCRIPT_ROOT } from "../config.js";

const ROOTS = ["reviews", "editing-plan"] as const;
const EXTS = new Set([".md", ".json"]);

export type DocKind = "review" | "decisions" | "rewrites" | "plan" | "findings" | "state";

interface ReviewDoc {
  rel_path: string; // includes the root dir, posix separators: "reviews/2026-06-13-....md"
  name: string;
  ext: string;
  kind: DocKind;
  date: string | null; // leading YYYY-MM-DD in the filename, if any
  scope: string | null; // filename remainder after date/kind prefixes
  title: string | null; // first "# " heading
  mtime: string;
  stats: Record<string, unknown>;
}

const DATED = /^(\d{4}-\d{2}-\d{2})-(.*)$/;

function classify(root: string, name: string, ext: string): { kind: DocKind; date: string | null; scope: string | null } {
  if (root === "editing-plan") {
    const m = name.match(DATED);
    return { kind: "plan", date: m ? m[1] : null, scope: m ? m[2] : name };
  }
  if (name === "voice-fingerprint" || name === "precedent-ledger") return { kind: "state", date: null, scope: name };
  const m = name.match(DATED);
  const date = m ? m[1] : null;
  const rest = m ? m[2] : name;
  if (rest.startsWith("writer-decisions-") || rest === "writer-decisions")
    return { kind: "decisions", date, scope: rest.replace(/^writer-decisions-?/, "") || null };
  if (rest.startsWith("suggested-rewrites-") || rest === "suggested-rewrites")
    return { kind: "rewrites", date, scope: rest.replace(/^suggested-rewrites-?/, "") || null };
  if (ext === ".json" || rest === "findings") return { kind: "findings", date, scope: rest };
  return { kind: "review", date, scope: rest };
}

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

function labelCounts(text: string, label: string, values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*\\[?\\s*(${values.join("|")})`, "gi");
  for (const m of text.matchAll(re)) {
    const key = m[1].toLowerCase();
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** v1 reviews have no per-finding Severity labels — findings live as table
 * rows or top-level bullets under "### Critical/High/Medium/Low" headings
 * ("### High Impact" is the ranked-fixes section, not a severity bucket). */
function v1SeverityCounts(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^###\s+(Critical|High|Medium|Low)\b(?!\s+Impact)/i);
    if (h) {
      current = h[1].toLowerCase();
      continue;
    }
    if (/^#{1,3}\s/.test(line)) current = null;
    if (current && (/^\|\s*\d+\s*\|/.test(line) || /^[-*]\s/.test(line))) out[current] = (out[current] ?? 0) + 1;
  }
  return out;
}

function verdictOf(text: string): string | null {
  const section = text.match(/##+\s*Sign-?Off[^\n]*\n([\s\S]{0,600})/i);
  const m = (section?.[1] ?? "").match(/\b(SIGN-OFF|CONDITIONAL|RE-OPEN)\b/);
  return m ? m[1] : null;
}

function statsFor(kind: DocKind, name: string, text: string): Record<string, unknown> {
  if (kind === "review") {
    let severity = labelCounts(text, "Severity", ["Critical", "High", "Medium", "Low"]);
    if (Object.keys(severity).length === 0) severity = v1SeverityCounts(text);
    // Prefer counting defined findings ("### RV-… —" heading blocks) over
    // every RV mention — mentions include cross-references to older reviews.
    const defined = count(text, /^###\s+RV-\d/gm);
    const mentioned = new Set(text.match(/\bRV-\d{4}-\d{2}-\d{2}-\d+\b/g) ?? []).size;
    const total = Object.values(severity).reduce((a, b) => a + b, 0);
    return { findings: defined || total || mentioned || null, severity, verdict: verdictOf(text) };
  }
  if (kind === "decisions") {
    const decisions = labelCounts(text, "Decision", ["Implement", "Push back", "Suggest-only", "Reclassify", "Defer"]);
    const defined = count(text, /^###\s+WP-/gm);
    const mentioned = new Set(text.match(/\bWP-(?:[LW]-)?\d+\b/g) ?? []).size;
    return { items: defined || mentioned || null, decisions, gate_fails: count(text, /\bFAIL\b/g) || 0 };
  }
  if (kind === "plan") {
    const defined = count(text, /^###\s+EP-/gm);
    const mentioned = new Set(text.match(/\bEP-[A-Za-z0-9-]*\d\b/g) ?? []).size;
    const effort = text.match(/\*\*Effort:\*\*\s*\[?\s*(S|M|L|XL)\b/i)?.[1]?.toUpperCase() ?? null;
    return { items: defined || mentioned || null, effort };
  }
  if (kind === "state" && name === "precedent-ledger") {
    return { entries: count(text, /^\s*(?:[-*]\s*)?WP-/gm) };
  }
  if (kind === "findings") {
    try {
      const j = JSON.parse(text);
      return { findings: Array.isArray(j.findings) ? j.findings.length : null, verdict: j.sign_off ?? null };
    } catch {
      return {};
    }
  }
  return {};
}

function scanDocs(): ReviewDoc[] {
  const docs: ReviewDoc[] = [];
  for (const root of ROOTS) {
    const rootDir = join(MANUSCRIPT_ROOT, root);
    if (!existsSync(rootDir)) continue;
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
        const name = entry.slice(0, dot);
        const text = readFileSync(full, "utf-8");
        const { kind, date, scope } = classify(root, name, ext);
        docs.push({
          rel_path: [root, relative(join(MANUSCRIPT_ROOT, root), full).split(sep).join("/")].join("/"),
          name,
          ext,
          kind,
          date,
          scope,
          title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null,
          mtime: st.mtime.toISOString(),
          stats: statsFor(kind, name, text),
        });
      }
    };
    walk(rootDir);
  }
  // Newest work first; undated state files sink to their group's end in the UI.
  return docs.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.rel_path.localeCompare(b.rel_path));
}

/** Resolve a requested path safely inside reviews/ or editing-plan/. */
function safeDocPath(rel: string): string | null {
  const root = ROOTS.find((r) => rel === r || rel.startsWith(`${r}/`));
  if (!root) return null;
  const rootDir = join(MANUSCRIPT_ROOT, root);
  const full = resolve(MANUSCRIPT_ROOT, rel);
  if (!full.startsWith(rootDir + sep)) return null;
  return full;
}

/** Where each RV-/EP-/WP- ID is *defined* (a "### <ID> …" heading), so
 * mentions in other documents can link back to the defining document. */
function buildIdIndex(docs: ReviewDoc[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const d of docs) {
    if (d.ext !== ".md") continue;
    const full = safeDocPath(d.rel_path);
    if (!full || !existsSync(full)) continue;
    const text = readFileSync(full, "utf-8");
    for (const m of text.matchAll(/^###\s+((?:RV|EP|WP)-[A-Za-z0-9-]*\d)\b/gm)) {
      if (!index.has(m[1])) index.set(m[1], d.rel_path);
    }
  }
  return index;
}

/** Highlight pipeline IDs in rendered HTML; IDs defined in another document
 * become links to it (the RV → EP → WP join chain, clickable). */
function linkifyIds(html: string, index: Map<string, string>, selfPath: string): string {
  return html.replace(/\b((?:RV|EP|WP)-[A-Za-z0-9-]*-?\d+)\b/g, (token) => {
    const target = index.get(token);
    if (target && target !== selfPath) return `<a class="ref-id" href="#/reviews/${encodeURI(target)}">${token}</a>`;
    return `<span class="ref-id">${token}</span>`;
  });
}

export default function reviewRoutes(app: FastifyInstance): void {
  app.get("/api/reviews", async () => {
    return {
      exists: ROOTS.some((r) => existsSync(join(MANUSCRIPT_ROOT, r))),
      docs: scanDocs(),
    };
  });

  app.get("/api/reviews/file", async (req, reply) => {
    const rel = String((req.query as { path?: string }).path ?? "");
    if (!rel) return reply.code(400).send({ error: "missing path" });
    const full = safeDocPath(rel);
    if (!full || !existsSync(full) || !statSync(full).isFile()) {
      return reply.code(404).send({ error: "unknown review document" });
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

    const html = await marked.parse(raw);
    return { ...base, kind: "md", html: linkifyIds(html as string, buildIdIndex(scanDocs()), rel) };
  });
}
