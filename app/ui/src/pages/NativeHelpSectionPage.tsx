import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import type { BookWriterTransport, HelpDocument } from "../transport";

interface Props {
  transport: BookWriterTransport;
  slug: string;
}

/**
 * Render one bundled guide.
 *
 * Guides are first-party documents shipped inside the application, unlike
 * manuscript and review documents, which the desktop boundary deliberately
 * presents as inert source text because they are user content. Rendering
 * applies only to this trusted set, and the packaged CSP still blocks any
 * script a guide might carry.
 */
export default function NativeHelpSectionPage({ transport, slug }: Props) {
  const [document, setDocument] = useState<HelpDocument | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setDocument(null);
    setError("");
    transport.help
      .get(slug)
      .then((value) => { if (alive) setDocument(value); })
      .catch((cause) => { if (alive) setError(String(cause?.message ?? cause)); });
    return () => { alive = false; };
  }, [transport, slug]);

  const html = useMemo(() => {
    if (!document || document.format !== "markdown") return "";
    return marked.parse(document.text, { async: false }) as string;
  }, [document]);

  if (error) return <><a className="back" href="#/help">← All guides</a><p className="err">{error}</p></>;
  if (!document) return <><a className="back" href="#/help">← All guides</a><p className="hint">Loading…</p></>;

  return (
    <>
      <a className="back" href="#/help">← All guides</a>
      <h1>{document.title}</h1>
      {document.format === "html" ? (
        // Self-styled standalone pages (the workflow map) are isolated in a
        // sandboxed frame so their own styling cannot leak into the app shell.
        <iframe
          title={document.title}
          srcDoc={document.text}
          sandbox=""
          style={{ width: "100%", height: "78vh", border: "1px solid var(--line, #ccc)", borderRadius: "8px", background: "#fff" }}
        />
      ) : (
        <div className="help-body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </>
  );
}
