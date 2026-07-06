import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function HelpSectionPage({ slug }: { slug: string }) {
  const [section, setSection] = useState<any>(null);
  useEffect(() => {
    api(`/api/help/${slug}`).then(setSection).catch((e) => setSection({ error: String(e.message ?? e) }));
  }, [slug]);

  if (!section) return <p className="hint">Loading…</p>;
  if (section.error) return <p className="err">{section.error}</p>;

  return (
    <>
      <a className="back" href="#/help">
        ← All guides
      </a>
      <h1>{section.title}</h1>
      <div className="help-body" dangerouslySetInnerHTML={{ __html: section.html }} />
    </>
  );
}
