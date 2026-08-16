import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { rootValue } from "./common.js";
import { safeReviewPath, toPosixRelative } from "./paths.js";

export const REVIEW_ROOTS = ["reviews", "editing-plan"] as const;
const REVIEW_EXTENSIONS = new Set([".md", ".json"]);
const DATED = /^(\d{4}-\d{2}-\d{2})-(.*)$/;

export type DocKind = "review" | "decisions" | "rewrites" | "plan" | "findings" | "state";

export interface ReviewClassification {
  kind: DocKind;
  date: string | null;
  scope: string | null;
}

export interface ReviewDoc {
  rel_path: string;
  name: string;
  ext: string;
  kind: DocKind;
  date: string | null;
  scope: string | null;
  title: string | null;
  mtime: string;
  stats: Record<string, unknown>;
}

export interface ReviewDocument {
  rel_path: string;
  path: string;
  kind: DocKind;
  mtime: string;
  bytes: number;
  raw: string;
  text: string;
}

export function classifyReviewFile(root: string, name: string, ext: string): ReviewClassification {
  if (root === "editing-plan") {
    const match = name.match(DATED);
    return { kind: "plan", date: match ? match[1] : null, scope: match ? match[2] : name };
  }
  if (name === "voice-fingerprint" || name === "precedent-ledger") {
    return { kind: "state", date: null, scope: name };
  }
  const match = name.match(DATED);
  const date = match ? match[1] : null;
  const rest = match ? match[2] : name;
  if (rest.startsWith("writer-decisions-") || rest === "writer-decisions") {
    return { kind: "decisions", date, scope: rest.replace(/^writer-decisions-?/, "") || null };
  }
  if (rest.startsWith("suggested-rewrites-") || rest === "suggested-rewrites") {
    return { kind: "rewrites", date, scope: rest.replace(/^suggested-rewrites-?/, "") || null };
  }
  if (ext === ".json" || rest === "findings") return { kind: "findings", date, scope: rest };
  return { kind: "review", date, scope: rest };
}

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

function labelCounts(text: string, label: string, values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*\\[?\\s*(${values.join("|")})`, "gi");
  for (const match of text.matchAll(re)) {
    const key = match[1].toLowerCase();
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function v1SeverityCounts(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^###\s+(Critical|High|Medium|Low)\b(?!\s+Impact)/i);
    if (heading) {
      current = heading[1].toLowerCase();
      continue;
    }
    if (/^#{1,3}\s/.test(line)) current = null;
    if (current && (/^\|\s*\d+\s*\|/.test(line) || /^[-*]\s/.test(line))) {
      out[current] = (out[current] ?? 0) + 1;
    }
  }
  return out;
}

function verdictOf(text: string): string | null {
  const section = text.match(/##+\s*Sign-?Off[^\n]*\n([\s\S]{0,600})/i);
  const match = (section?.[1] ?? "").match(/\b(SIGN-OFF|CONDITIONAL|RE-OPEN)\b/);
  return match ? match[1] : null;
}

export function statsForReview(kind: DocKind, name: string, text: string): Record<string, unknown> {
  if (kind === "review") {
    let severity = labelCounts(text, "Severity", ["Critical", "High", "Medium", "Low"]);
    if (Object.keys(severity).length === 0) severity = v1SeverityCounts(text);
    const defined = count(text, /^###\s+RV-\d/gm);
    const mentioned = new Set(text.match(/\bRV-\d{4}-\d{2}-\d{2}-\d+\b/g) ?? []).size;
    const total = Object.values(severity).reduce((sum, value) => sum + value, 0);
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
      const json = JSON.parse(text);
      return { findings: Array.isArray(json.findings) ? json.findings.length : null, verdict: json.sign_off ?? null };
    } catch {
      return {};
    }
  }
  return {};
}

/** Scan review/editing-plan documents under projectRoot. */
export function scanReviewDocs(projectRoot: string): ReviewDoc[] {
  const project = rootValue(projectRoot, "projectRoot");
  const docs: ReviewDoc[] = [];
  for (const rootName of REVIEW_ROOTS) {
    const rootDir = join(project, rootName);
    if (!existsSync(rootDir)) continue;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir).sort()) {
        if (entry.startsWith(".")) continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
          continue;
        }
        const dot = entry.lastIndexOf(".");
        const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : "";
        if (!REVIEW_EXTENSIONS.has(ext)) continue;
        const name = entry.slice(0, dot);
        const text = readFileSync(fullPath, "utf-8");
        const classification = classifyReviewFile(rootName, name, ext);
        docs.push({
          rel_path: `${rootName}/${toPosixRelative(rootDir, fullPath)}`,
          name,
          ext,
          ...classification,
          title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null,
          mtime: stat.mtime.toISOString(),
          stats: statsForReview(classification.kind, name, text),
        });
      }
    };
    walk(rootDir);
  }
  return docs.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.rel_path.localeCompare(b.rel_path));
}

export function readReviewFile(projectRoot: string, relPath: string): ReviewDocument | null {
  const project = rootValue(projectRoot, "projectRoot");
  const path = safeReviewPath(project, relPath);
  if (!path || !existsSync(path) || !statSync(path).isFile()) return null;
  const raw = readFileSync(path, "utf-8");
  const stat = statSync(path);
  const slash = relPath.replace(/\\/g, "/");
  const rootName = REVIEW_ROOTS.find((root) => slash.startsWith(`${root}/`));
  const dot = slash.lastIndexOf(".");
  const name = slash.slice(slash.lastIndexOf("/") + 1, dot >= 0 ? dot : undefined);
  const ext = dot >= 0 ? slash.slice(dot).toLowerCase() : "";
  const kind = classifyReviewFile(rootName ?? "reviews", name, ext).kind;
  let text = raw;
  if (ext === ".json") {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // Keep malformed JSON readable as-is.
    }
  }
  return { rel_path: slash, path, kind, mtime: stat.mtime.toISOString(), bytes: stat.size, raw, text };
}

/** Map each defined RV-/EP-/WP- heading to its source document. */
export function buildReviewIdIndex(projectRoot: string, docs: readonly ReviewDoc[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const doc of docs) {
    if (doc.ext !== ".md") continue;
    const file = readReviewFile(projectRoot, doc.rel_path);
    if (!file) continue;
    for (const match of file.raw.matchAll(/^###\s+((?:RV|EP|WP)-[A-Za-z0-9-]*\d)\b/gm)) {
      if (!index.has(match[1])) index.set(match[1], doc.rel_path);
    }
  }
  return index;
}

export function linkifyReviewIds(html: string, index: Map<string, string>, selfPath: string): string {
  return html.replace(/\b((?:RV|EP|WP)-[A-Za-z0-9-]*-?\d+)\b/g, (token) => {
    const target = index.get(token);
    if (target && target !== selfPath) return `<a class="ref-id" href="#/reviews/${encodeURI(target)}">${token}</a>`;
    return `<span class="ref-id">${token}</span>`;
  });
}
