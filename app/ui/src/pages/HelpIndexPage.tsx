import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function HelpIndexPage() {
  const [sections, setSections] = useState<any[]>([]);
  useEffect(() => {
    api("/api/help").then((d) => setSections(d.sections)).catch(() => {});
  }, []);

  return (
    <>
      <h1>Guides</h1>
      <p className="sub">
        Each guide is its own short page — pick the one you need instead of scrolling a single giant document.
      </p>
      <div className="help-grid">
        {sections.map((s, i) => (
          <a
            key={s.slug}
            className="help-card card"
            href={s.external ?? `#/help/${s.slug}`}
            target={s.external ? "_blank" : undefined}
            rel={s.external ? "noreferrer" : undefined}
          >
            <span className="n">{String(i + 1).padStart(2, "0")}</span>
            <h3>
              {s.title}
              {s.external ? " ↗" : ""}
            </h3>
            <p>{s.blurb}</p>
          </a>
        ))}
      </div>
    </>
  );
}
