import { lazy, Suspense, useEffect, useState } from "react";
import { api, type SkillSummary } from "./lib/api";
import Sidebar, { type SidebarItem } from "./components/Sidebar";
import TopBar from "./components/TopBar";
import { nativeSkills, NATIVE_PHASE_LABELS } from "./lib/nativeSkills";
import { createTransport, type ProjectDetail, type ProjectImportInput, type ProjectSummary } from "./transport";

// Route pages are intentionally loaded on demand. The renderer shell (sidebar,
// top bar, and transport selection) is needed for every route, while heavier
// pages pull in their data/rendering dependencies only when visited.
const ChaptersPage = lazy(() => import("./pages/ChaptersPage"));
const SkillPage = lazy(() => import("./pages/SkillPage"));
const RagPage = lazy(() => import("./pages/RagPage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const WorldPage = lazy(() => import("./pages/WorldPage"));
const ReviewsPage = lazy(() => import("./pages/ReviewsPage"));
const HelpIndexPage = lazy(() => import("./pages/HelpIndexPage"));
const HelpSectionPage = lazy(() => import("./pages/HelpSectionPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NativeSkillPage = lazy(() => import("./pages/NativeSkillPage"));
const NativeReviewsPage = lazy(() => import("./pages/NativeReviewsPage"));
const NativeHelpPage = lazy(() => import("./pages/NativeHelpPage"));
const NativeHelpSectionPage = lazy(() => import("./pages/NativeHelpSectionPage"));
const ProviderOnboardingPage = lazy(() => import("./pages/ProviderOnboardingPage"));
const NativeRagPage = lazy(() => import("./pages/NativeRagPage"));

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

export default function App() {
  const route = useHashRoute();
  const native = transport.mode === "electron";
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<string>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [projectError, setProjectError] = useState("");
  const [sidebar, setSidebar] = useState<SidebarItem[]>([]);
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
        const detail = await transport.projects.get(next);
        if (alive) { setProjectId(next); setProject(detail); }
        if (native) {
          const preferred = await transport.settings.get(next, "preferredProvider");
          if (alive && !preferred) location.hash = "#/providers";
        }
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
      const detail = await transport.projects.get(next);
      localStorage.setItem("bw-project-id", next);
      setProjectId(next);
      setProject(detail);
      location.hash = "#/chapters";
    } catch (error: any) {
      setProjectError(String(error?.message ?? error));
    }
  };

  const importProject = async (input: ProjectImportInput) => {
    setProjectError("");
    try {
      const imported = await transport.projects.import(input);
      if (!imported) return;
      setProjects(await transport.projects.list());
      await transport.projects.open(imported.projectId);
      localStorage.setItem("bw-project-id", imported.projectId);
      setProjectId(imported.projectId);
      setProject(imported);
      location.hash = native ? "#/providers" : "#/world";
    } catch (error: any) {
      setProjectError(String(error?.message ?? error));
    }
  };

  const loadSkills = () => {
    if (native) {
      setSidebar(nativeSkills(project?.profile));
      setPhaseLabels(NATIVE_PHASE_LABELS);
      setSidebarError(false);
      return;
    }
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
  useEffect(loadSkills, [native, project?.profile]);

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
    let alive = true;
    if (native) {
      if (!projectId) { setActiveRuns([]); return () => { alive = false; }; }
      const pollNative = () => transport.runs.list({ projectId, limit: 10 }).then((runs) => {
        if (alive) setActiveRuns(runs.filter((run) => run.status === "running" || run.status === "starting" || run.status === "queued").map((run) => ({ run_id: run.runId, skill_id: run.skillId ?? null })));
      }).catch(() => alive && setActiveRuns([]));
      void pollNative();
      const nativeTimer = setInterval(pollNative, 10_000);
      return () => { alive = false; clearInterval(nativeTimer); };
    }
    const poll = () => api("/api/claude/runs?limit=10")
      .then((data) => {
        if (alive) setActiveRuns((data.runs ?? []).filter((run: any) => run.status === "running" || run.status === "queued"));
      })
      .catch(() => alive && setActiveRuns([]));
    poll();
    const timer = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [native, projectId]);

  let page: JSX.Element;
  if (native && route === "/projects") {
    page = <><h1>Add a project</h1><div className="empty"><p><strong>Choose a manuscript folder and its writing profile.</strong></p><p>The fishing option creates a portable nonfiction configuration and scaffolds a Knowledge Base without overwriting existing files.</p><p><button className="btn" onClick={() => importProject({ profile: "nonfiction", preset: "fly-night-fishing" })}>Import Fly &amp; Night Fishing Book</button> <button className="btn ghost" onClick={() => importProject({ profile: "fantasy" })}>Import Fantasy Book</button></p></div></>;
  } else if (native && route === "/settings") {
    page = <SettingsPage transport={transport} projectId={projectId} />;
  } else if (native && route === "/providers") {
    page = <ProviderOnboardingPage transport={transport} projectId={projectId} />;
  } else if (native && route.startsWith("/skill/")) {
    const id = decodeURIComponent(route.slice("/skill/".length));
    page = <NativeSkillPage key={id} transport={transport} projectId={projectId} skill={sidebar.find((item) => item.skill_id === id && !item.alias) ?? sidebar.find((item) => item.skill_id === id)} />;
  } else if (native && (route === "/reviews" || route.startsWith("/reviews/"))) {
    page = <NativeReviewsPage transport={transport} projectId={projectId} path={route === "/reviews" ? "" : decodeURI(route.slice("/reviews/".length))} />;
  } else if (native && route.startsWith("/help/")) {
    page = <NativeHelpSectionPage key={route} transport={transport} slug={route.slice("/help/".length)} />;
  } else if (native && route.startsWith("/help")) {
    page = <NativeHelpPage transport={transport} />;
  } else if (native && route === "/rag") {
    page = <NativeRagPage transport={transport} projectId={projectId} />;
  } else if (route.startsWith("/skill/")) {
    const id = decodeURIComponent(route.slice("/skill/".length));
    page = <SkillPage key={id} skillId={id} bridgeOk={!!health?.bridge?.ok} ragOk={!!health?.rag?.ok} />;
  } else if (route === "/rag") {
    page = <RagPage />;
  } else if (route === "/search") {
    page = <SearchPage transport={transport} projectId={projectId} />;
  } else if (route === "/world" || route.startsWith("/world/")) {
    page = <WorldPage transport={transport} projectId={projectId} profile={project?.profile} path={route === "/world" ? "" : decodeURI(route.slice("/world/".length))} />;
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

  const needsProject = native && (route === "/chapters" || route.startsWith("/chapters/") || route === "/world" || route.startsWith("/world/") || route === "/search" || route === "/settings" || route === "/providers" || route.startsWith("/skill/") || route === "/reviews" || route.startsWith("/reviews/"));
  if (needsProject && projects !== null && projects.length === 0) {
    page = (
      <>
        <h1>No project configured</h1>
        <div className="empty">
          <p><strong>Choose a manuscript folder and its writing profile.</strong></p>
          <p>The fishing option creates a portable nonfiction configuration and scaffolds a Knowledge Base without overwriting existing files.</p>
          <p><button className="btn" onClick={() => importProject({ profile: "nonfiction", preset: "fly-night-fishing" })}>Import Fly &amp; Night Fishing Book</button> <button className="btn ghost" onClick={() => importProject({ profile: "fantasy" })}>Import Fantasy Book</button></p>
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
        memoryLabel={project?.profile?.memoryLabel ?? "World"}
        activeRuns={activeRuns.map((run) => ({
          ...run,
          skill_name: sidebar.find((skill) => skill.skill_id === run.skill_id)?.display_name ?? run.skill_id ?? "run",
        }))}
      />
      <Sidebar route={route} items={sidebar} phaseLabels={phaseLabels} error={sidebarError} onRetry={loadSkills} />
      <main className="main">
        {projectError && <p className="err">Project error: {projectError}</p>}
        <Suspense fallback={<p className="hint" role="status">Loading page…</p>}>{page}</Suspense>
      </main>
    </div>
  );
}
