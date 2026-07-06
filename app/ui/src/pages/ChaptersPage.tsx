import { useEffect, useState } from "react";
import { api, type ChapterSummary } from "../lib/api";

const BOOK_LABELS: Record<string, string> = { "book-1": "Book 1", "book-2": "Book 2", prequel: "Prequel" };

export default function ChaptersPage() {
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [chapter, setChapter] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api("/api/chapters").then((d) => setChapters(d.chapters));
  useEffect(() => {
    load().catch(() => setChapters([]));
  }, []);

  useEffect(() => {
    if (!selected) return setChapter(null);
    setChapter(null);
    api(`/api/chapters/${encodeURIComponent(selected)}`).then(setChapter).catch(() => setChapter({ error: true }));
  }, [selected]);

  const sync = async () => {
    setBusy(true);
    try {
      await api("/api/chapters/sync", { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const refreshOne = async () => {
    if (!selected) return;
    setChapter(await api(`/api/chapters/${encodeURIComponent(selected)}?fresh=1`));
  };

  if (chapters === null) return <p className="hint">Loading chapters…</p>;

  if (chapters.length === 0) {
    return (
      <>
        <h1>Chapter Texts</h1>
        <div className="empty">
          <div className="glyph">❧</div>
          <p>
            <strong>No chapters yet.</strong> This book hasn't been started.
          </p>
          <p>
            Files named <code>Chapter NN - Title.txt</code> placed in <code>chapters/</code> (or{" "}
            <code>book-2/chapters/</code> / <code>prequel-novella/chapters/</code>) will appear here.
          </p>
          <p>
            <button className="btn ghost" onClick={sync} disabled={busy}>
              {busy ? "Scanning…" : "Scan for chapters"}
            </button>
          </p>
        </div>
      </>
    );
  }

  const books = [...new Set(chapters.map((c) => c.book))];
  const idx = chapters.findIndex((c) => c.chapter_id === selected);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Chapter Texts</h1>
        <button className="btn ghost" onClick={sync} disabled={busy} title="Re-scan the chapter folders">
          {busy ? "Syncing…" : "Sync all"}
        </button>
      </div>
      <div className="chapters-grid">
        <div className="chapter-list card">
          {books.map((book) => (
            <div key={book}>
              <div className="book-head">{BOOK_LABELS[book] ?? book}</div>
              {chapters
                .filter((c) => c.book === book)
                .map((c) => (
                  <button
                    key={c.chapter_id}
                    className={`item ${c.chapter_id === selected ? "active" : ""}`}
                    onClick={() => setSelected(c.chapter_id)}
                  >
                    <span className="num">{c.number === 9999 ? "—" : c.number}</span>
                    <span>{c.title}</span>
                    <span className="words">{c.word_count.toLocaleString()} w</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div>
          {!selected && <p className="hint">Pick a chapter from the list to read it.</p>}
          {selected && !chapter && <p className="hint">Loading…</p>}
          {chapter?.error && <p className="err">Failed to load chapter.</p>}
          {chapter && !chapter.error && (
            <>
              <div className="reading-head">
                <h2>{chapter.title}</h2>
                <span className="hint">{chapter.word_count.toLocaleString()} words</span>
                <span className="spacer" style={{ flex: 1 }} />
                <button className="btn ghost" disabled={idx <= 0} onClick={() => setSelected(chapters[idx - 1].chapter_id)}>
                  ← Prev
                </button>
                <button
                  className="btn ghost"
                  disabled={idx < 0 || idx >= chapters.length - 1}
                  onClick={() => setSelected(chapters[idx + 1].chapter_id)}
                >
                  Next →
                </button>
                <button className="btn ghost" onClick={refreshOne} title="Re-read this chapter's file from disk">
                  ⟳
                </button>
              </div>
              <div className="reading">{chapter.text}</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
