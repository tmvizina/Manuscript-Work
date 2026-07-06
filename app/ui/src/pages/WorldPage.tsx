import { useEffect, useState } from "react";
import { api } from "../lib/api";

const GROUP_LABELS: Record<string, string> = {
  "": "World",
  characters: "Characters",
  locations: "Locations",
  factions: "Factions",
  "magic-and-objects": "Magic & Objects",
  threads: "Threads",
  timeline: "Timeline",
  continuity: "Continuity",
  "voice-bible": "Voice Bible",
};

function labelFor(dir: string): string {
  return GROUP_LABELS[dir] ?? dir.split("/").map((p) => p.replace(/-/g, " ")).join(" / ");
}

export default function WorldPage({ path }: { path: string }) {
  const [tree, setTree] = useState<any>(null);
  const [file, setFile] = useState<any>(null);

  useEffect(() => {
    api("/api/world").then(setTree).catch(() => setTree({ exists: false, groups: [] }));
  }, []);

  useEffect(() => {
    if (!path) return setFile(null);
    setFile(null);
    api(`/api/world/file?path=${encodeURIComponent(path)}`)
      .then(setFile)
      .catch((e) => setFile({ error: String(e.message ?? e) }));
  }, [path]);

  if (!tree) return <p className="hint">Loading world…</p>;

  const isEmpty = !tree.exists || tree.groups.length === 0;
  if (isEmpty) {
    return (
      <>
        <h1>World</h1>
        <div className="empty">
          <div className="glyph">✦</div>
          <p>
            <strong>The world/ memory hasn't been seeded yet.</strong>
          </p>
          <p>
            The <a href="#/skill/outline-enhancer">Outline Enhancer</a> seeds it from your first sketch, and the{" "}
            <a href="#/skill/world-notes-seeder">World Notes Seeder</a> ingests your notes into it. Files under{" "}
            <code>world/</code> (characters, threads, arcs, voice bible, continuity) will appear here as a browsable
            wiki.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>World</h1>
      <p className="sub">
        The canon memory as a wiki — every file under <code>world/</code>, rendered. <code>[[links]]</code> jump between
        entries. Read-only here: edits go through the seeder skills (or your editor), then{" "}
        <a href="#/rag">rebuild the RAG index</a>.
      </p>
      <div className="chapters-grid">
        <div className="chapter-list card">
          {tree.groups.map((g: any) => (
            <div key={g.dir}>
              <div className="book-head">{labelFor(g.dir)}</div>
              {g.files.map((f: any) => (
                <button
                  key={f.rel_path}
                  className={`item ${f.rel_path === path ? "active" : ""}`}
                  onClick={() => {
                    location.hash = `#/world/${encodeURI(f.rel_path)}`;
                  }}
                >
                  <span>{f.name.replace(/-/g, " ")}</span>
                  {f.ext === ".json" && <span className="words">json</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div>
          {!path && <p className="hint">Pick an entry from the left to read it.</p>}
          {path && !file && <p className="hint">Loading…</p>}
          {file?.error && <p className="err">{file.error}</p>}
          {file && !file.error && (
            <>
              <div className="reading-head">
                <h2>{path.split("/").pop()?.replace(/\.(md|json)$/i, "").replace(/-/g, " ")}</h2>
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
