import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface ReviewDoc {
  rel_path: string;
  name: string;
  ext: string;
  kind: "review" | "decisions" | "rewrites" | "plan" | "findings" | "state";
  date: string | null;
  scope: string | null;
  title: string | null;
  mtime: string;
  stats: Record<string, any>;
}

const GROUPS: Array<{ kinds: ReviewDoc["kind"][]; label: string }> = [
  { kinds: ["review", "findings"], label: "Review Runs" },
  { kinds: ["decisions", "rewrites"], label: "Writer Decisions" },
  { kinds: ["plan"], label: "Editing Plans" },
  { kinds: ["state"], label: "Writer State" },
];

const SEV_ORDER = ["critical", "high", "medium", "low"] as const;
const DECISION_LABELS: Record<string, string> = {
  implement: "implement",
  "push back": "push back",
  "suggest-only": "suggest-only",
  reclassify: "reclassify",
  defer: "defer",
};

function itemLabel(d: ReviewDoc): string {
  if (d.kind === "state") return d.name.replace(/-/g, " ");
  const scope = (d.scope ?? d.name).replace(/-/g, " ");
  return scope || d.name.replace(/-/g, " ");
}

function StatChips({ d }: { d: ReviewDoc }) {
  const s = d.stats ?? {};
  const chips: JSX.Element[] = [];
  if (d.kind === "review" || d.kind === "findings") {
    if (s.findings) chips.push(<span key="n" className="chip">{s.findings} findings</span>);
    for (const sev of SEV_ORDER) {
      const n = s.severity?.[sev];
      if (n) chips.push(<span key={sev} className={`chip sev-${sev}`}>{n} {sev}</span>);
    }
    if (s.verdict) chips.push(<span key="v" className={`chip verdict-${String(s.verdict).toLowerCase()}`}>{s.verdict}</span>);
  }
  if (d.kind === "decisions") {
    for (const [key, label] of Object.entries(DECISION_LABELS)) {
      const n = s.decisions?.[key];
      if (n) chips.push(<span key={key} className={`chip dec-${key.replace(/\s/g, "-")}`}>{n} {label}</span>);
    }
  }
  if (d.kind === "plan" && s.items) chips.push(<span key="i" className="chip">{s.items} items</span>);
  if (d.kind === "plan" && s.effort) chips.push(<span key="e" className="chip">effort {s.effort}</span>);
  if (d.kind === "state" && s.entries != null) chips.push(<span key="l" className="chip">{s.entries} precedents</span>);
  if (d.ext === ".json") chips.push(<span key="j" className="chip">json</span>);
  if (!chips.length) return null;
  return <span className="doc-chips">{chips}</span>;
}

export default function ReviewsPage({ path }: { path: string }) {
  const [tree, setTree] = useState<{ exists: boolean; docs: ReviewDoc[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [file, setFile] = useState<any>(null);

  const load = () => {
    setLoadError(false);
    api("/api/reviews")
      .then(setTree)
      .catch(() => {
        setTree({ exists: false, docs: [] });
        setLoadError(true);
      });
  };
  useEffect(load, []);

  useEffect(() => {
    if (!path) return setFile(null);
    setFile(null);
    api(`/api/reviews/file?path=${encodeURIComponent(path)}`)
      .then(setFile)
      .catch((e) => setFile({ error: String(e.message ?? e) }));
  }, [path]);

  if (!tree) return <p className="hint">Loading reviews…</p>;

  if (loadError) {
    return (
      <>
        <h1>Reviews</h1>
        <div className="empty">
          <div className="glyph">⚠</div>
          <p>
            <strong>Couldn't load reviews.</strong> The server didn't respond — is it running?
          </p>
          <p>
            <button className="btn ghost" onClick={load}>
              Retry
            </button>
          </p>
        </div>
      </>
    );
  }

  if (!tree.exists || tree.docs.length === 0) {
    return (
      <>
        <h1>Reviews</h1>
        <div className="empty">
          <div className="glyph">¶</div>
          <p>
            <strong>No review runs yet.</strong>
          </p>
          <p>
            The <a href="#/skill/book-reviewer-v2">Book Reviewer</a> writes review reports to <code>reviews/</code>, the{" "}
            <a href="#/skill/manuscript-editing-planner-v2">Editing Planner</a> writes plans to <code>editing-plan/</code>,
            and the <a href="#/skill/manuscript-writer-v2">Writer</a> logs its triage decisions (Implement / Push back /
            Suggest-only) back to <code>reviews/</code>. Run them and their reports appear here.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Reviews</h1>
      <p className="sub">
        The revision loop, visible: lector review reports, the editing plans built from them, and the writer's per-finding
        triage decisions. <code>RV / EP / WP</code> IDs link between documents.
      </p>
      <div className="chapters-grid">
        <div className="chapter-list card">
          {GROUPS.map((g) => {
            const docs = tree.docs.filter((d) => g.kinds.includes(d.kind));
            if (!docs.length) return null;
            return (
              <div key={g.label}>
                <div className="book-head">{g.label}</div>
                {docs.map((d) => (
                  <button
                    key={d.rel_path}
                    className={`item doc-item ${d.rel_path === path ? "active" : ""}`}
                    onClick={() => {
                      location.hash = `#/reviews/${encodeURI(d.rel_path)}`;
                    }}
                  >
                    <span className="doc-main">
                      <span>{itemLabel(d)}</span>
                      {d.date && <span className="words">{d.date}</span>}
                    </span>
                    <StatChips d={d} />
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div>
          {!path && <p className="hint">Pick a document from the left — review reports, editing plans, writer decisions.</p>}
          {path && !file && <p className="hint">Loading…</p>}
          {file?.error && <p className="err">{file.error}</p>}
          {file && !file.error && (
            <>
              <div className="reading-head">
                <h2>{path.split("/").pop()?.replace(/\.(md|json)$/i, "")}</h2>
                <span className="hint">
                  {file.rel_path} · updated {new Date(file.mtime).toLocaleDateString()}
                </span>
              </div>
              {file.kind === "md" ? (
                <div className="help-body wiki-body" dangerouslySetInnerHTML={{ __html: file.html }} />
              ) : (
                <pre className="wiki-json">{file.text}</pre>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
