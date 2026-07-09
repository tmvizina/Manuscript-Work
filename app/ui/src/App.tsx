import { useEffect, useState } from "react";
import { api, type SkillSummary } from "./lib/api";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import ChaptersPage from "./pages/ChaptersPage";
import SkillPage from "./pages/SkillPage";
import RagPage from "./pages/RagPage";
import WorldPage from "./pages/WorldPage";
import ReviewsPage from "./pages/ReviewsPage";
import HelpIndexPage from "./pages/HelpIndexPage";
import HelpSectionPage from "./pages/HelpSectionPage";

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
  const [sidebar, setSidebar] = useState<SkillSummary[]>([]);
  const [sidebarError, setSidebarError] = useState(false);
  const [phaseLabels, setPhaseLabels] = useState<Record<string, string>>({});
  const [health, setHealth] = useState<any>(null);

  const loadSkills = () => {
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
  useEffect(loadSkills, []);

  useEffect(() => {
    let alive = true;
    const poll = () => api("/api/health").then((h) => alive && setHealth(h)).catch(() => alive && setHealth(null));
    poll();
    const t = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  let page: JSX.Element;
  if (route.startsWith("/skill/")) {
    const id = decodeURIComponent(route.slice("/skill/".length));
    page = <SkillPage key={id} skillId={id} bridgeOk={!!health?.bridge?.ok} />;
  } else if (route === "/rag") {
    page = <RagPage />;
  } else if (route === "/world" || route.startsWith("/world/")) {
    page = <WorldPage path={route === "/world" ? "" : decodeURI(route.slice("/world/".length))} />;
  } else if (route === "/reviews" || route.startsWith("/reviews/")) {
    page = <ReviewsPage path={route === "/reviews" ? "" : decodeURI(route.slice("/reviews/".length))} />;
  } else if (route === "/help") {
    page = <HelpIndexPage />;
  } else if (route.startsWith("/help/")) {
    page = <HelpSectionPage key={route} slug={route.slice("/help/".length)} />;
  } else {
    const selected = route.startsWith("/chapters/") ? decodeURIComponent(route.slice("/chapters/".length)) : null;
    page = <ChaptersPage selectedId={selected} />;
  }

  return (
    <div className="layout">
      <TopBar route={route} health={health} />
      <Sidebar route={route} items={sidebar} phaseLabels={phaseLabels} error={sidebarError} onRetry={loadSkills} />
      <main className="main">{page}</main>
    </div>
  );
}
