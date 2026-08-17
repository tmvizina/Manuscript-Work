import { useState, type FormEvent } from "react";
import type { BookWriterTransport, SearchResult, SearchScope } from "../transport";

export default function SearchPage({ transport, projectId }: { transport: BookWriterTransport; projectId?: string }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try { setResults(await transport.search.query({ projectId, query: query.trim(), scope, limit: 50 })); }
    catch (caught: any) { setResults(null); setError(String(caught?.message ?? caught)); }
    finally { setBusy(false); }
  };

  return <>
    <h1>Project Search</h1>
    <p className="sub">Bounded literal search across trusted manuscript files. Semantic RAG remains a separate browser feature.</p>
    <form className="row search-form" onSubmit={submit}>
      <input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search text…" aria-label="Search text" />
      <select value={scope} onChange={(event) => setScope(event.target.value as SearchScope)} aria-label="Search scope"><option value="all">Everything</option><option value="chapters">Chapters</option><option value="world">World</option><option value="reviews">Reviews</option></select>
      <button className="btn" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search"}</button>
    </form>
    {error && <div className="empty"><p><strong>Search unavailable.</strong></p><p>{error}</p></div>}
    {results?.length === 0 && <p className="hint">No matches found.</p>}
    {results && results.length > 0 && <div className="search-results">{results.map((result) => <article className="card" key={result.resultId}><div className="row"><strong>{result.title}</strong><span className="hint">{result.scope} · {result.relPath}</span></div><p>{result.snippet}</p></article>)}</div>}
  </>;
}
