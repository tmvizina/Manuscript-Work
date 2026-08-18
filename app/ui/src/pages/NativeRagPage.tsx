import { useEffect, useRef, useState } from "react";
import type { BookWriterTransport, RagProgressEvent, RagQueryResult, RagStatus } from "../transport";

interface Props {
  transport: BookWriterTransport;
  projectId?: string;
}

export interface RagViewState {
  /** The build shipped without the model; nothing here can be built. */
  unavailable: boolean;
  indexing: boolean;
  /** Something is already indexed, so querying is meaningful. */
  indexed: boolean;
  canQuery: boolean;
  headline: string;
  detail: string;
  actionLabel: "Build index" | "Rebuild index" | "Stop indexing";
}

/**
 * Derive everything the view renders from the persisted status plus the latest
 * progress event. Kept pure so the state machine can be tested without a DOM.
 */
export function describeRagState(status: RagStatus | null, progress: RagProgressEvent | null): RagViewState {
  const unavailable = status !== null && !status.available;
  const indexing = status?.status === "indexing" || progress?.status === "indexing";
  const indexed = (status?.totalChunks ?? 0) > 0;

  let headline = "";
  let detail = "";
  if (unavailable) {
    headline = "Semantic search needs its model file";
    detail = "The model ships as a separate file because it is too large to include in the installer. Install it once and it stays installed.";
  } else if (indexing) {
    headline = "Indexing…";
    detail = progress
      ? `${progress.filesIndexed} of ${progress.filesTotal} files, ${progress.chunksEmbedded} passages${progress.currentPath ? ` — ${progress.currentPath}` : ""}`
      : "starting";
  } else if (status?.status === "failed") {
    headline = "The last index failed";
    // Partial results survive a failure, so say so rather than implying the
    // index is gone.
    detail = `${status.lastError ?? "No detail was recorded."}${indexed ? ` ${status.totalChunks} previously indexed passages are still searchable.` : ""}`;
  } else if (status?.status === "cancelled") {
    headline = "Index was cancelled";
    detail = `${status.totalChunks} passages were indexed before it stopped. Building again continues where it left off.`;
  } else if (status?.status === "ready") {
    headline = "Ready";
    detail = `${status.totalChunks} passages indexed${status.lastIndexedAt ? ` — last built ${new Date(status.lastIndexedAt).toLocaleString()}` : ""}.`;
  } else {
    headline = "Not indexed yet";
    detail = "Build the index to search your manuscript by meaning rather than exact wording.";
  }

  return {
    unavailable,
    indexing,
    indexed,
    canQuery: indexed && !unavailable,
    headline,
    detail,
    actionLabel: indexing ? "Stop indexing" : indexed ? "Rebuild index" : "Build index",
  };
}

/**
 * Semantic search over the local index.
 *
 * Deliberately distinct from the Search page: that one is bounded literal
 * matching, this ranks by cosine similarity, and presenting them as the same
 * thing would misrepresent what either returns.
 */
export default function NativeRagPage({ transport, projectId }: Props) {
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [progress, setProgress] = useState<RagProgressEvent | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RagQueryResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const subscriptionRef = useRef<string | null>(null);

  const refresh = () => {
    if (!projectId) return;
    transport.rag
      .status(projectId)
      .then(setStatus)
      .catch((cause) => setError(String(cause?.message ?? cause)));
  };

  useEffect(refresh, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let released = false;
    transport.rag
      .subscribe(projectId, (event) => {
        setProgress(event);
        // A terminal event means the persisted status changed; re-read it
        // rather than inferring it from the event alone.
        if (event.status !== "indexing") {
          setProgress(null);
          refresh();
        }
      })
      .then((subscription) => {
        if (released) {
          void transport.rag.unsubscribe(subscription.subscriptionId);
          return;
        }
        subscriptionRef.current = subscription.subscriptionId;
      })
      .catch(() => {
        // Progress is an enhancement; the page still works by polling status.
      });
    return () => {
      released = true;
      const id = subscriptionRef.current;
      subscriptionRef.current = null;
      if (id) void transport.rag.unsubscribe(id);
    };
  }, [projectId, transport]);

  const runQuery = async () => {
    if (!projectId || !query.trim()) return;
    setBusy(true);
    setError("");
    setResults(null);
    try {
      setResults(await transport.rag.query(projectId, query.trim()));
    } catch (cause: any) {
      setError(String(cause?.message ?? cause));
    } finally {
      setBusy(false);
    }
  };

  const installModel = async () => {
    setInstalling(true);
    setError("");
    try {
      const result = await transport.rag.installModel();
      // A cancelled picker is not a failure; say nothing and leave the state.
      if (result.status === "rejected") setError(result.message);
      if (result.status === "installed" || result.status === "already_installed") refresh();
    } catch (cause: any) {
      setError(String(cause?.message ?? cause));
    } finally {
      setInstalling(false);
    }
  };

  const startIndex = async () => {
    if (!projectId) return;
    setError("");
    try {
      await transport.rag.reindex(projectId);
      refresh();
    } catch (cause: any) {
      setError(String(cause?.message ?? cause));
    }
  };

  const cancelIndex = async () => {
    if (!projectId) return;
    try {
      await transport.rag.cancel(projectId);
    } catch (cause: any) {
      setError(String(cause?.message ?? cause));
    }
  };

  if (!projectId) return <><h1>Semantic search</h1><p className="hint">Select a project first.</p></>;

  const view = describeRagState(status, progress);

  if (view.unavailable) {
    return (
      <>
        <h1>Semantic search</h1>
        {error && <p className="err">{error}</p>}
        <div className="empty">
          <p><strong>{view.headline}.</strong></p>
          <p>{view.detail}</p>
          <p>
            <button className="btn" onClick={installModel} disabled={installing}>
              {installing ? "Installing…" : "Install model file…"}
            </button>
          </p>
          <p className="hint">Literal search still works from the Search page meanwhile.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Semantic search</h1>

      {error && <p className="err">{error}</p>}

      <div className="empty" style={{ marginBottom: "1rem" }}>
        <p role={view.indexing ? "status" : undefined}>
          <strong>{view.headline}.</strong> {view.detail}
        </p>
        <p>
          {view.indexing ? (
            <button className="btn ghost" onClick={cancelIndex}>{view.actionLabel}</button>
          ) : (
            <button className="btn" onClick={startIndex}>{view.actionLabel}</button>
          )}
        </p>
      </div>

      <div className="row">
        <input
          className="input"
          placeholder="Describe what you are looking for…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void runQuery(); }}
          disabled={!view.canQuery}
          aria-label="Semantic search query"
        />
        <button className="btn" onClick={runQuery} disabled={!view.canQuery || busy || query.trim().length === 0}>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {!view.indexed && !view.indexing && <p className="hint">Build the index before searching.</p>}
      {view.indexing && view.indexed && <p className="hint">Searching now uses the passages indexed before this run started.</p>}

      {results && results.length === 0 && <p className="hint">No passages matched.</p>}
      {results && results.length > 0 && (
        <ul className="results">
          {results.map((result) => (
            <li key={result.chunkId}>
              <div className="meta">
                <strong>{result.relPath}</strong>
                {result.heading ? ` — ${result.heading}` : ""}
                <span className="hint"> · {result.book} · similarity {result.score.toFixed(3)}</span>
              </div>
              <p>{result.text}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
