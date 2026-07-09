import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export default function RagPage() {
  const [q, setQ] = useState("");
  const [k, setK] = useState(5);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [ingestJob, setIngestJob] = useState<any>(null);
  const [log, setLog] = useState<any[]>([]);

  const pollRef = useRef<number | null>(null);

  const refresh = () => {
    api("/api/rag/health").then(setHealth).catch(() => setHealth({ ok: false }));
    api("/api/rag/queries").then((d) => setLog(d.queries)).catch(() => {});
  };
  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  const query = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await api("/api/rag/query", { method: "POST", body: JSON.stringify({ q, k }) }));
    } catch (e: any) {
      setResult({ ok: false, error: String(e.message ?? e) });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const stopPolling = () => {
    if (pollRef.current !== null) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const rebuild = async () => {
    setIngestJob({ status: "running", message: "starting…" });
    let job_id: string;
    try {
      ({ job_id } = await api<{ job_id: string }>("/api/rag/ingest", { method: "POST" }));
    } catch (e: any) {
      setIngestJob({ status: "error", error: String(e.message ?? e) });
      return;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const job = await api(`/api/jobs/${job_id}`);
        setIngestJob(job);
        if (job.status === "done" || job.status === "error") {
          stopPolling();
          refresh();
        }
      } catch (e: any) {
        stopPolling();
        setIngestJob({ status: "error", error: String(e.message ?? e) });
      }
    }, 2000);
  };

  return (
    <>
      <h1>Canon RAG</h1>
      <p className="sub">
        Semantic search over the book's canon — <code>world/</code> memory plus every chapter — retrieving only the
        relevant chunks instead of whole files. <a href="#/help/rag">How it works</a> ·{" "}
        <a href="#/help/rag-maint">Maintaining the index</a>
      </p>

      <div className="card">
        <div className="rag-controls">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query()}
            placeholder="Ask the canon… e.g. who is the protagonist's father?"
          />
          <label className="hint" title="How many matching chunks to retrieve">
            results: {k}
            <input type="range" min={1} max={20} value={k} onChange={(e) => setK(Number(e.target.value))} />
          </label>
          <button className="btn" onClick={query} disabled={busy || !q.trim()}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          {health?.ok ? `${health.chunks.toLocaleString()} chunks indexed` : "RAG service unreachable"} ·{" "}
          <button className="btn ghost" onClick={rebuild} disabled={ingestJob?.status === "running"}>
            {ingestJob?.status === "running" ? "Rebuilding…" : "Rebuild index"}
          </button>
          {ingestJob?.status === "done" && (
            <> rebuilt: {ingestJob.result?.chunks} chunks from {ingestJob.result?.files} files in {ingestJob.result?.seconds}s</>
          )}
          {ingestJob?.status === "error" && <span className="err"> rebuild failed: {ingestJob.error}</span>}
        </p>
      </div>

      {result && !result.ok && <p className="err">{result.error}</p>}
      {result?.ok && (
        <>
          <p className="hint" style={{ marginTop: 14 }}>
            {result.results.length} chunks · ~{result.total_tokens.toLocaleString()} tokens total · {result.latency_ms} ms
            — a whole-file pull for the same answer typically costs 10–50× more tokens.
          </p>
          {result.results.map((r: any, i: number) => (
            <div className="card result-card" key={i}>
              <div className="src">
                <span className="path">{r.source}</span>
                {r.heading && <span>§ {r.heading}</span>}
                <span className="chip">{r.book}</span>
                <span>score {r.score}</span>
                <span>~{r.tokens} tok</span>
              </div>
              <div className="chunk-text">{r.text}</div>
            </div>
          ))}
        </>
      )}

      <div className="card" style={{ marginTop: 22 }}>
        <h3 style={{ marginTop: 0 }}>Recent queries</h3>
        <p className="hint">
          Queries tagged <span className="chip rag">skill</span> came from RAG-aware skill runs — proof the variants are
          using the index.
        </p>
        <table className="log">
          <thead>
            <tr>
              <th>when</th>
              <th>source</th>
              <th>query</th>
              <th>chunks</th>
              <th>tokens</th>
              <th>ms</th>
            </tr>
          </thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.query_id}>
                <td>{new Date(r.created_at).toLocaleTimeString()}</td>
                <td>{r.source}</td>
                <td>{r.q.slice(0, 60)}</td>
                <td>{r.ok ? r.result_count : <span className="err">err</span>}</td>
                <td>{r.total_tokens ?? ""}</td>
                <td>{r.latency_ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
