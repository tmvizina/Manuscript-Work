import { useEffect, useState } from "react";
import { api, type SkillSummary } from "./lib/api";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import ChaptersPage from "./pages/ChaptersPage";
import SkillPage from "./pages/SkillPage";
import RagPage from "./pages/RagPage";
import SearchPage from "./pages/SearchPage";
import WorldPage from "./pages/WorldPage";
import ReviewsPage from "./pages/ReviewsPage";
import HelpIndexPage from "./pages/HelpIndexPage";
import HelpSectionPage from "./pages/HelpSectionPage";
import { createTransport, type ProjectSummary } from "./transport";

const transport = createTransport();

export function useHashRoute(): string {
  const [hash, setHash] = useState(location.hash.slice(1) || "/chapters");
  useEffect(() => {
    const onChange = () => setHash(location.hash.slice(1) || "/chapters");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function PendingDesktopPage({ feature }: { feature: string }) {
  return (
    <>
      <h1>{feature}</h1>
      <div className="empty">
        <p><strong>This feature is not connected to native IPC yet.</strong></p>
        <p>The desktop app will not fall back to a localhost server. Use the browser compatibility app until this migration slice lands.</p>
      </div>
    </>
  );
}

export default function App() {
  const route = useHashRoute();
  const native = transport.mode === "electron";
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<string>();
  const [projectError, setProjectError] = useState("");
  const [sidebar, setSidebar] = useState<SkillSummary[]>([]);
  const [sidebarError, setSidebarError] = useState(false);
  const [phaseLabels, setPhaseLabels] = useState<Record<string, string>>({});
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    transport.projects.list()
      .then(async (items) => {
        if (!alive) return;
        setProjects(items);
        if (items.length === 0) return;
        const remembered = localStorage.getItem("bw-project-id");
        const next = items.find((item) => item.projectId === remembered)?.projectId ?? items[0].projectId;
        await transport.projects.open(next);
        if (alive) setProjectId(next);
      })
      .catch((error) => {
        if (!alive) return;
        setProjects([]);
        setProjectError(String(error?.message ?? error));
      });
    return () => { alive = false; };
  }, []);

  const selectProject = async (next: string) => {
    setProjectError("");
    try {
      await transport.projects.open(next);
      localStorage.setItem("bw-project-id", next);
      setProjectId(next);
      location.hash = "#/chapters";
    } catch (error: any) {
      setProjectError(String(error?.message ?? error));
    }
  };

  const loadSkills = () => {
    if (native) return;
    setSidebarError(false);
    api("/api/skills")
      .then((d) => {
        setSidebar(d.sidebar ?? d.skills);
        setPhaseLabels(d.phase_labels ?? {});
      })
      .catch(() => {
        setSidebar([]);
        setSidebarError(true);
      });
  };
  useEffect(loadSkills, [native]);

  useEffect(() => {
    if (native) return;
    let alive = true;
    const poll = () => api("/api/health").then((h) => alive && setHealth(h)).catch(() => alive && setHealth(null));
    poll();
    const timer = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [native]);

  const [activeRuns, setActiveRuns] = useState<Array<{ run_id: string; skill_id: string | null }>>([]);
  useEffect(() => {
    if (native) return;
    let alive = true;
    const poll = () => api("/api/claude/runs?limit=10")
      .then((data) => {
        if (alive) setActiveRuns((data.runs ?? []).filter((run: any) => run.status === "running" || run.status === "queued"));
      })
      .catch(() => alive && setActiveRuns([]));
    poll();
    const timer = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [native]);

  let page: JSX.Element;
  if (native && (route.startsWith("/skill/") || route === "/rag" || route.startsWith("/reviews") || route.startsWith("/help"))) {
    page = <PendingDesktopPage feature={route.startsWith("/help") ? "Help" : route.startsWith("/reviews") ? "Reviews" : route === "/rag" ? "RAG" : "Skills"} />;
  } else if (route.startsWith("/skill/")) {
    const id = decodeURIComponent(route.slice("/skill/".length));
    page = <SkillPage key={id} skillId={id} bridgeOk={!!health?.bridge?.ok} ragOk={!!health?.rag?.ok} />;
  } else if (route === "/rag") {
    page = <RagPage />;
  } else if (route === "/search") {
    page = <SearchPage transport={transport} projectId={projectId} />;
  } else if (route === "/world" || route.startsWith("/world/")) {
    page = <WorldPage transport={transport} projectId={projectId} path={route === "/world" ? "" : decodeURI(route.slice("/world/".length))} />;
  } else if (route === "/reviews" || route.startsWith("/reviews/")) {
    page = <ReviewsPage path={route === "/reviews" ? "" : decodeURI(route.slice("/reviews/".length))} />;
  } else if (route === "/help") {
    page = <HelpIndexPage />;
  } else if (route.startsWith("/help/")) {
    page = <HelpSectionPage key={route} slug={route.slice("/help/".length)} />;
  } else {
    const selected = route.startsWith("/chapters/") ? decodeURIComponent(route.slice("/chapters/".length)) : null;
    page = <ChaptersPage transport={transport} projectId={projectId} selectedId={selected} />;
  }

  const needsProject = native && (route === "/chapters" || route.startsWith("/chapters/") || route === "/world" || route.startsWith("/world/") || route === "/search");
  if (needsProject && projects !== null && projects.length === 0) {
    page = (
      <>
        <h1>No project configured</h1>
        <div className="empty">
          <p><strong>The desktop database does not contain a trusted manuscript project.</strong></p>
          <p>Project import belongs to the first-run wizard. Until that ticket lands, use a previously registered project or the browser compatibility app.</p>
        </div>
      </>
    );
  } else if (needsProject && (!projects || !projectId)) {
    page = <p className="hint">Loading projects…</p>;
  }

  return (
    <div className="layout">
      <TopBar
        route={route}
        health={health}
        mode={transport.mode}
        projects={projects ?? []}
        projectId={projectId}
        onProjectChange={selectProject}
        activeRuns={activeRuns.map((run) => ({
          ...run,
          skill_name: sidebar.find((skill) => skill.skill_id === run.skill_id)?.display_name ?? run.skill_id ?? "run",
        }))}
      />
      <Sidebar route={route} items={sidebar} phaseLabels={phaseLabels} error={sidebarError} onRetry={loadSkills} />
      <main className="main">
        {projectError && <p className="err">Project error: {projectError}</p>}
        {page}
      </main>
    </div>
  );
}
