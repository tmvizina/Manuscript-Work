import { useEffect, useState } from "react";
import type { BookWriterTransport, ReviewDocument, ReviewSummary } from "../transport";

export default function NativeReviewsPage({ transport, projectId, path }: { transport: BookWriterTransport; projectId?: string; path: string }) {
  const [documents, setDocuments] = useState<ReviewSummary[] | null>(null);
  const [document, setDocument] = useState<ReviewDocument | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setDocuments(null); setError("");
    if (!projectId) return;
    transport.content.listReviews(projectId).then(setDocuments).catch((reason) => setError(String(reason?.message ?? reason)));
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
  return <><h1>Reviews</h1><p className="sub">Project review reports, editing plans, and writer decisions.</p><div className="chapters-grid"><div className="chapter-list card">{documents.map((item) => <button key={item.relPath} className={`item doc-item ${item.relPath === path ? "active" : ""}`} onClick={() => { location.hash = `#/reviews/${encodeURI(item.relPath)}`; }}><span className="doc-main"><span>{item.title ?? item.scope ?? item.name}</span>{item.date && <span className="words">{item.date}</span>}</span></button>)}</div><div>{!path && <p className="hint">Pick a document from the left.</p>}{path && !document && <p className="hint">Loading...</p>}{document && <><div className="reading-head"><h2>{document.relPath.split("/").pop()}</h2><span className="hint">updated {new Date(document.updatedAt).toLocaleDateString()}</span></div><pre className="wiki-json native-document">{document.text}</pre></>}</div></div></>;
}
