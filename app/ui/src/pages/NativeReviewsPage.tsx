import { useEffect, useState } from "react";
import { renderReviewMarkdown } from "../lib/markdown";
import type { BookWriterTransport, ReviewDocument, ReviewIdReference, ReviewSummary } from "../transport";

export default function NativeReviewsPage({ transport, projectId, path }: { transport: BookWriterTransport; projectId?: string; path: string }) {
  const [documents, setDocuments] = useState<ReviewSummary[] | null>(null);
  const [document, setDocument] = useState<ReviewDocument | null>(null);
  const [idIndex, setIdIndex] = useState<ReviewIdReference[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setDocuments(null); setError("");
    if (!projectId) return;
    transport.content.listReviews(projectId).then(setDocuments).catch((reason) => setError(String(reason?.message ?? reason)));
  }, [projectId, transport]);
  useEffect(() => {
    if (!projectId) return;
    // Resolves the RV -> EP -> WP chain; a failure only costs the links.
    transport.content.reviewIdIndex(projectId).then(setIdIndex).catch(() => setIdIndex([]));
  }, [projectId, transport]);
  useEffect(() => {
    setDocument(null); setError("");
    if (!projectId || !path) return;
    transport.content.getReview(projectId, path).then(setDocument).catch((reason) => setError(String(reason?.message ?? reason)));
  }, [projectId, path, transport]);
  if (!projectId) return <><h1>Reviews</h1><p className="hint">Select or import a project first.</p></>;
  if (error) return <><h1>Reviews</h1><p className="err">{error}</p></>;
  if (!documents) return <><h1>Reviews</h1><p className="hint">Loading reviews...</p></>;
  if (documents.length === 0) return <><h1>Reviews</h1><div className="empty"><p><strong>No review runs yet.</strong></p><p>Review reports and editing plans written under <code>reviews/</code> and <code>editing-plan/</code> will appear here.</p></div></>;
  return <><h1>Reviews</h1><p className="sub">Project review reports, editing plans, and writer decisions.</p><div className="chapters-grid"><div className="chapter-list card">{documents.map((item) => <button key={item.relPath} className={`item doc-item ${item.relPath === path ? "active" : ""}`} onClick={() => { location.hash = `#/reviews/${encodeURI(item.relPath)}`; }}><span className="doc-main"><span>{item.title ?? item.scope ?? item.name}</span>{item.date && <span className="words">{item.date}</span>}</span></button>)}</div><div>{!path && <p className="hint">Pick a document from the left.</p>}{path && !document && <p className="hint">Loading...</p>}{document && <><div className="reading-head"><h2>{document.relPath.split("/").pop()}</h2><span className="hint">updated {new Date(document.updatedAt).toLocaleDateString()}</span></div>{/\.md$/i.test(document.relPath)
  ? <div className="help-body wiki-body" dangerouslySetInnerHTML={{ __html: renderReviewMarkdown(document.text, idIndex, document.relPath) }} />
  : <pre className="wiki-json native-document">{document.text}</pre>}</>}</div></div></>;
}
