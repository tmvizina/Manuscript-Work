import { useEffect, useState } from "react";
import type { BookWriterTransport, HelpSectionSummary } from "../transport";

/**
 * The guide index. Each card links to its own page rather than being an inert
 * summary, so the desktop app carries the same library as the browser app
 * instead of a hardcoded précis of it.
 */
export default function NativeHelpPage({ transport }: { transport: BookWriterTransport }) {
  const [sections, setSections] = useState<HelpSectionSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    transport.help
      .list()
      .then(setSections)
      .catch((cause) => {
        setSections([]);
        setError(String(cause?.message ?? cause));
      });
  };
  useEffect(load, [transport]);

  return (
    <>
      <h1>Guides</h1>
      <p className="sub">
        Each guide is its own short page — pick the one you need instead of scrolling a single giant document.
      </p>
      {error && (
        <p className="err">
          Couldn't load the guides. <button className="btn ghost" onClick={load}>Retry</button>
        </p>
      )}
      {sections === null && <p className="hint">Loading…</p>}
      <div className="help-grid">
        {(sections ?? []).map((section, index) => {
          const card = (
            <>
              <span className="n">{String(index + 1).padStart(2, "0")}</span>
              <h3>{section.title}</h3>
              <p>{section.blurb}</p>
            </>
          );
          // A guide missing from this build must not look clickable.
          return section.available ? (
            <a key={section.slug} className="help-card card" href={`#/help/${section.slug}`}>{card}</a>
          ) : (
            <div key={section.slug} className="help-card card" aria-disabled="true" style={{ opacity: 0.55 }}>
              {card}
              <p className="hint">Not included in this build.</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
