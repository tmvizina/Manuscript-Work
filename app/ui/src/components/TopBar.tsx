import { useState } from "react";

function Dot({ ok, label, title }: { ok: boolean | undefined; label: string; title?: string }) {
  return (
    <span title={title ?? (ok ? `${label}: connected` : `${label}: unreachable`)}>
      <span className={`dot ${ok === undefined ? "" : ok ? "ok" : "bad"}`} />
      {label}
    </span>
  );
}

export default function TopBar({ route, health }: { route: string; health: any }) {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    localStorage.setItem("bw-theme", next);
  };

  return (
    <header className="topbar">
      <a className="brand" href="#/chapters">
        Book <em>Writer</em>
      </a>
      <a className={`navlink ${route === "/world" || route.startsWith("/world/") ? "active" : ""}`} href="#/world">
        World
      </a>
      <a className={`navlink ${route === "/rag" ? "active" : ""}`} href="#/rag">
        RAG
      </a>
      <span className="spacer" />
      <span className="dots">
        <Dot ok={health?.bridge?.ok} label="bridge" title={health?.bridge?.ok ? `claude ${health.bridge.version}` : health?.bridge?.hint ?? "bridge unreachable — see Help → Claude Bridge"} />
        <Dot ok={health?.rag?.ok} label="rag" title={health?.rag?.ok ? `${health.rag.chunks} chunks indexed` : "rag service unreachable"} />
      </span>
      <button className="iconbtn" onClick={toggleTheme} title="Toggle theme">
        {theme === "dark" ? "☾" : "☀"}
      </button>
      <a className="iconbtn help" href="#/help" title="Guides & help">
        ?
      </a>
    </header>
  );
}
