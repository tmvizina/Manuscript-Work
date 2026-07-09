import { useEffect, useState } from "react";
import { api, type ChapterSummary } from "../lib/api";

const BOOK_LABELS: Record<string, string> = { "book-1": "Book 1", "book-2": "Book 2", prequel: "Prequel" };

export default function ChaptersPage({ selectedId }: { selectedId: string | null }) {
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [chapter, setChapter] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = () => {
    setLoadError(false);
    return api("/api/chapters")
      .then((d) => setChapters(d.chapters))
      .catch(() => {
        setChapters([]);
        setLoadError(true);
      });
  };
  useEffect(() => {
    load();
  }, []);

  const select = (id: string | null) => {
    location.hash = id ? `#/chapters/${encodeURIComponent(id)}` : "#/chapters";
  };

  useEffect(() => {
    if (!selectedId) return setChapter(null);
    setChapter(null);
    api(`/api/chapters/${encodeURIComponent(selectedId)}`).then(setChapter).catch(() => setChapter({ error: true }));
  }, [selectedId]);

  const sync = async () => {
    setBusy(true);
    setActionError("");
    try {
      await api("/api/chapters/sync", { method: "POST" });
      await load();
    } catch (e: any) {
      setActionError(`Sync failed: ${String(e.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  const refreshOne = async () => {
    if (!selectedId) return;
    setActionError("");
    try {
      setChapter(await api(`/api/chapters/${encodeURIComponent(selectedId)}?fresh=1`));
    } catch (e: any) {
      setActionError(`Refresh failed: ${String(e.message ?? e)}`);
    }
  };

  if (chapters === null) return <p className="hint">Loading chapters…</p>;

  if (loadError) {
    return (
      <>
        <h1>Chapter Texts</h1>
        <div className="empty">
          <div className="glyph">⚠</div>
          <p>
            <strong>Couldn't load chapters.</strong> The server didn't respond — is it running?
          </p>
          <p>
            <button
              className="btn ghost"
              onClick={() => {
                setChapters(null);
                load();
              }}
            >
              Retry
            </button>
          </p>
        </div>
      </>
    );
  }

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
  const idx = chapters.findIndex((c) => c.chapter_id === selectedId);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Chapter Texts</h1>
        <button className="btn ghost" onClick={sync} disabled={busy} title="Re-scan the chapter folders">
          {busy ? "Syncing…" : "Sync all"}
        </button>
      </div>
      {actionError && <p className="err">{actionError}</p>}
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
                    className={`item ${c.chapter_id === selectedId ? "active" : ""}`}
                    onClick={() => select(c.chapter_id)}
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
          {!selectedId && <p className="hint">Pick a chapter from the list to read it.</p>}
          {selectedId && !chapter && <p className="hint">Loading…</p>}
          {chapter?.error && <p className="err">Failed to load chapter.</p>}
          {chapter && !chapter.error && (
            <>
              <div className="reading-head">
                <h2>{chapter.title}</h2>
                <span className="hint">{chapter.word_count.toLocaleString()} words</span>
                <span className="spacer" style={{ flex: 1 }} />
                <button className="btn ghost" disabled={idx <= 0} onClick={() => select(chapters[idx - 1].chapter_id)}>
                  ← Prev
                </button>
                <button
                  className="btn ghost"
                  disabled={idx < 0 || idx >= chapters.length - 1}
                  onClick={() => select(chapters[idx + 1].chapter_id)}
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
