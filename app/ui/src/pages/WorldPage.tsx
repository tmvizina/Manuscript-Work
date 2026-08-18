import { useEffect, useState } from "react";
import { renderWorldMarkdown } from "../lib/markdown";
import type { BookWriterTransport, ProjectProfileConfig, WorldDocument, WorldSummary } from "../transport";

const FANTASY_LABELS: Record<string, string> = { "": "World", characters: "Characters", locations: "Locations", factions: "Factions", "magic-and-objects": "Magic & Objects", threads: "Threads", timeline: "Timeline", continuity: "Continuity", "voice-bible": "Voice Bible" };
const NONFICTION_LABELS: Record<string, string> = { "": "Knowledge Base", author: "Author & Voice", audience: "Audience", topics: "Topics", techniques: "Techniques", equipment: "Equipment", species: "Species", conditions: "Conditions", places: "Places", people: "People", stories: "Stories", "safety-and-regulations": "Safety & Regulations", terminology: "Terminology", claims: "Claims", sources: "Sources", continuity: "Continuity", _intake: "Intake Archive" };
const labelFor = (dir: string, profile?: ProjectProfileConfig) => (profile?.profile === "nonfiction" ? NONFICTION_LABELS : FANTASY_LABELS)[dir] ?? dir.split("/").map((part) => part.replace(/-/g, " ")).join(" / ");
const fileName = (path: string) => path.split("/").pop() ?? path;

export interface WorldGroup { dir: string; files: WorldSummary[] }
export function groupWorld(entries: WorldSummary[]): WorldGroup[] {
  const groups = new Map<string, WorldSummary[]>();
  for (const entry of entries) {
    const normalized = entry.relPath.replaceAll("\\", "/");
    const slash = normalized.lastIndexOf("/");
    const dir = slash < 0 ? "" : normalized.slice(0, slash);
    groups.set(dir, [...(groups.get(dir) ?? []), entry]);
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([dir, files]) => ({
    dir,
    files: files.sort((left, right) => left.relPath.replaceAll("\\", "/").localeCompare(right.relPath.replaceAll("\\", "/"))),
  }));
}

export default function WorldPage({ transport, projectId, path, profile }: { transport: BookWriterTransport; projectId?: string; path: string; profile?: ProjectProfileConfig }) {
  const [entries, setEntries] = useState<WorldSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [file, setFile] = useState<WorldDocument | null>(null);
  const [fileError, setFileError] = useState("");
  const [filter, setFilter] = useState("");
  const memoryLabel = profile?.memoryLabel ?? "World";

  useEffect(() => {
    setLoadError("");
    transport.world.list(projectId).then(setEntries).catch((error) => {
      setEntries([]);
      setLoadError(String(error?.message ?? error));
    });
  }, [projectId, transport]);

  useEffect(() => {
    setFileError("");
    if (!path) { setFile(null); return; }
    setFile(null);
    transport.world.get(projectId, path).then(setFile).catch((error) => setFileError(String(error?.message ?? error)));
  }, [path, projectId, transport]);

  if (entries === null) return <p className="hint">Loading {memoryLabel.toLowerCase()}…</p>;
  if (loadError) return <><h1>{memoryLabel}</h1><div className="empty"><p><strong>Couldn't load {memoryLabel.toLowerCase()}.</strong></p><p>{loadError}</p></div></>;
  if (entries.length === 0) return <><h1>{memoryLabel}</h1><div className="empty"><p><strong>The {memoryLabel.toLowerCase()} hasn't been seeded yet.</strong></p><p>Files under <code>world/</code> will appear here as a read-only wiki.</p></div></>;

  const query = filter.trim().toLowerCase();
  const groups = groupWorld(entries).map((group) => ({ ...group, files: query ? group.files.filter((entry) => (entry.title ?? fileName(entry.relPath)).replace(/-/g, " ").toLowerCase().includes(query)) : group.files })).filter((group) => group.files.length > 0);
  const isMarkdown = file ? (file.kind === "md" || /\.md$/i.test(file.relPath)) : false;
  const updated = file?.updatedAt ? new Date(file.updatedAt) : undefined;

  return <>
    <h1>{memoryLabel}</h1><p className="sub">{profile?.profile === "nonfiction" ? "Project knowledge, firsthand experience, claims, and continuity" : "Canon memory"} from <code>world/</code>, exposed read-only through the active runtime.</p>
    <div className="chapters-grid">
      <div className="chapter-list card">
        <input className="list-filter" type="text" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter entries…" />
        {groups.length === 0 && <p className="hint">No entries match "{filter}".</p>}
        {groups.map((group) => <div key={group.dir}><div className="book-head">{labelFor(group.dir, profile)}</div>{group.files.map((entry) => {
          const name = entry.title ?? fileName(entry.relPath).replace(/\.(md|json)$/i, "").replace(/-/g, " ");
          return <button key={entry.relPath} className={`item ${entry.relPath === path ? "active" : ""}`} onClick={() => { location.hash = `#/world/${encodeURI(entry.relPath)}`; }}><span>{name}</span>{/\.json$/i.test(entry.relPath) && <span className="words">json</span>}</button>;
        })}</div>)}
      </div>
      <div>
        {!path && <p className="hint">Pick an entry from the left to read it.</p>}
        {path && !file && !fileError && <p className="hint">Loading…</p>}
        {fileError && <p className="err">{fileError}</p>}
        {file && <><div className="reading-head"><h2>{fileName(path).replace(/\.(md|json)$/i, "").replace(/-/g, " ")}</h2><span className="hint">{file.relPath}{updated && !Number.isNaN(updated.valueOf()) ? ` · updated ${updated.toLocaleDateString()}` : ""}</span></div>
          {isMarkdown
            ? <div
                className="help-body wiki-body"
                // The server pre-renders and linkifies; the native boundary
                // returns source, so the same treatment is applied here rather
                // than leaving [[wikilinks]] as literal text.
                dangerouslySetInnerHTML={{ __html: file.html ?? renderWorldMarkdown(file.text, entries) }}
              />
            : <pre className="wiki-json">{file.text}</pre>}
        </>}
      </div>
    </div>
  </>;
}
