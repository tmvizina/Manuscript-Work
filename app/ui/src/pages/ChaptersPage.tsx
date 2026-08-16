import { useEffect, useState } from "react";
import type { BookWriterTransport, ChapterDocument, ChapterSummary } from "../transport";

const BOOK_LABELS: Record<string, string> = { "book-1": "Book 1", "book-2": "Book 2", prequel: "Prequel" };

export default function ChaptersPage({ transport, projectId, selectedId }: {
  transport: BookWriterTransport;
  projectId?: string;
  selectedId: string | null;
}) {
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [chapter, setChapter] = useState<ChapterDocument | null>(null);
  const [chapterError, setChapterError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [filter, setFilter] = useState("");

  const load = () => {
    setLoadError("");
    return transport.chapters.list(projectId)
      .then(setChapters)
      .catch((error) => {
        setChapters([]);
        setLoadError(String(error?.message ?? error));
      });
  };
  useEffect(() => { void load(); }, [projectId, transport]);

  const select = (id: string | null) => {
    location.hash = id ? `#/chapters/${encodeURIComponent(id)}` : "#/chapters";
  };

  useEffect(() => {
    setChapterError("");
    if (!selectedId) { setChapter(null); return; }
    setChapter(null);
    transport.chapters.get(projectId, selectedId)
      .then(setChapter)
      .catch((error) => setChapterError(String(error?.message ?? error)));
  }, [projectId, selectedId, transport]);

  const sync = async () => {
    setBusy(true);
    setActionError("");
    try { setChapters(await transport.chapters.refresh(projectId)); }
    catch (error: any) { setActionError(`Refresh failed: ${String(error?.message ?? error)}`); }
    finally { setBusy(false); }
  };

  const refreshOne = async () => {
    if (!selectedId) return;
    setActionError("");
    try { setChapter(await transport.chapters.get(projectId, selectedId, { fresh: true })); }
    catch (error: any) { setActionError(`Refresh failed: ${String(error?.message ?? error)}`); }
  };

  if (chapters === null) return <p className="hint">Loading chapters…</p>;
  if (loadError) return <><h1>Chapter Texts</h1><div className="empty"><p><strong>Couldn't load chapters.</strong></p><p>{loadError}</p><button className="btn ghost" onClick={() => { setChapters(null); void load(); }}>Retry</button></div></>;
  if (chapters.length === 0) return <><h1>Chapter Texts</h1><div className="empty"><p><strong>No chapters yet.</strong></p><p>Files named <code>Chapter NN - Title.txt</code> in a chapter folder will appear here.</p><button className="btn ghost" onClick={sync} disabled={busy}>{busy ? "Scanning…" : "Scan for chapters"}</button></div></>;

  const query = filter.trim().toLowerCase();
  const visible = query ? chapters.filter((item) => `${item.number} ${item.title}`.toLowerCase().includes(query)) : chapters;
  const books = [...new Set(visible.map((item) => item.book))];
  const index = chapters.findIndex((item) => item.chapterId === selectedId);

  return <>
    <div className="row" style={{ justifyContent: "space-between" }}><h1>Chapter Texts</h1><button className="btn ghost" onClick={sync} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button></div>
    {actionError && <p className="err">{actionError}</p>}
    <div className="chapters-grid">
      <div className="chapter-list card">
        <input className="list-filter" type="text" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter chapters…" />
        {visible.length === 0 && <p className="hint">No chapters match "{filter}".</p>}
        {books.map((book) => <div key={book}><div className="book-head">{BOOK_LABELS[book] ?? book}</div>{visible.filter((item) => item.book === book).map((item) =>
          <button key={item.chapterId} className={`item ${item.chapterId === selectedId ? "active" : ""}`} onClick={() => select(item.chapterId)}>
            <span className="num">{item.number === 9999 ? "—" : item.number}</span><span>{item.title}</span><span className="words">{item.wordCount.toLocaleString()} w</span>
          </button>)}</div>)}
      </div>
      <div>
        {!selectedId && <p className="hint">Pick a chapter from the list to read it.</p>}
        {selectedId && !chapter && !chapterError && <p className="hint">Loading…</p>}
        {chapterError && <p className="err">Failed to load chapter: {chapterError}</p>}
        {chapter && <><div className="reading-head"><h2>{chapter.title}</h2><span className="hint">{chapter.wordCount.toLocaleString()} words</span><span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost" disabled={index <= 0} onClick={() => select(chapters[index - 1].chapterId)}>← Prev</button>
          <button className="btn ghost" disabled={index < 0 || index >= chapters.length - 1} onClick={() => select(chapters[index + 1].chapterId)}>Next →</button>
          <button className="btn ghost" onClick={refreshOne} title="Re-read this chapter from disk">Refresh</button>
        </div><div className="reading">{chapter.text}</div></>}
      </div>
    </div>
  </>;
}
