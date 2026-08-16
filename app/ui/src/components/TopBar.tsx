import { useState } from "react";
import type { ProjectSummary, TransportMode } from "../transport";

function Dot({ ok, label, title }: { ok: boolean | undefined; label: string; title?: string }) {
  return (
    <span title={title ?? (ok ? `${label}: connected` : `${label}: unreachable`)}>
      <span className={`dot ${ok === undefined ? "" : ok ? "ok" : "bad"}`} />
      {label}
    </span>
  );
}

export interface ActiveRun {
  run_id: string;
  skill_id: string | null;
  skill_name: string;
}

export default function TopBar({
  route,
  health,
  activeRuns = [],
  mode,
  projects,
  projectId,
  onProjectChange,
  memoryLabel,
}: {
  route: string;
  health: any;
  activeRuns?: ActiveRun[];
  mode: TransportMode;
  projects: ProjectSummary[];
  projectId?: string;
  onProjectChange(projectId: string): void;
  memoryLabel: string;
}) {
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
        {memoryLabel}
      </a>
      {mode === "electron" ? <><a className={`navlink ${route === "/search" ? "active" : ""}`} href="#/search">Search</a><a className={`navlink ${route.startsWith("/reviews") ? "active" : ""}`} href="#/reviews">Reviews</a></> : <>
        <a className={`navlink ${route === "/reviews" || route.startsWith("/reviews/") ? "active" : ""}`} href="#/reviews">Reviews</a>
        <a className={`navlink ${route === "/rag" ? "active" : ""}`} href="#/rag">RAG</a>
      </>}
      <span className="spacer" />
      {mode === "electron" && projects.length > 0 && <select className="project-picker" aria-label="Active project" value={projectId ?? ""} onChange={(event) => onProjectChange(event.target.value)}>
        {!projectId && <option value="" disabled>Select project</option>}
        {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
      </select>}
      {mode === "electron" && <a className="iconbtn" href="#/projects" title="Add a project">+</a>}
      {mode === "electron" && <a className={`iconbtn ${route === "/settings" ? "active" : ""}`} href="#/settings" title="Project settings">&#9881;</a>}
      {mode === "electron" && <a className={`iconbtn ${route === "/providers" ? "active" : ""}`} href="#/providers" title="Provider setup">&#9889;</a>}
      {mode === "electron" && <a className="iconbtn help" href="#/help" title="Guides & help">?</a>}
      {activeRuns.length > 0 && (
        <a
          className="runchip"
          href={activeRuns[0].skill_id ? `#/skill/${activeRuns[0].skill_id}` : undefined}
          title="A claude run is in progress — click to watch it"
        >
          <span className="pulse" />
          {activeRuns[0].skill_name}
          {activeRuns.length > 1 && ` +${activeRuns.length - 1}`}
        </a>
      )}
      {mode === "http" && <span className="dots">
        <Dot ok={health?.bridge?.ok} label="bridge" title={health?.bridge?.ok ? `claude ${health.bridge.version}` : health?.bridge?.hint ?? "bridge unreachable — see Help → Claude Bridge"} />
        <Dot ok={health?.rag?.ok} label="rag" title={health?.rag?.ok ? `${health.rag.chunks} chunks indexed` : "rag service unreachable"} />
      </span>}
      <button className="iconbtn" onClick={toggleTheme} title="Toggle theme">
        {theme === "dark" ? "☾" : "☀"}
      </button>
      {mode === "http" && <a className="iconbtn help" href="#/help" title="Guides & help">
        ?
      </a>}
    </header>
  );
}
