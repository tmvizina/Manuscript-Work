import type { SkillSummary } from "../lib/api";

export interface SidebarItem extends SkillSummary {
  alias?: boolean;
}

export default function Sidebar({
  route,
  items,
  phaseLabels,
  error,
  onRetry,
}: {
  route: string;
  items: SidebarItem[];
  phaseLabels: Record<string, string>;
  error?: boolean;
  onRetry?: () => void;
}) {
  const go = (path: string) => () => {
    location.hash = path;
  };
  let lastPhase = "";

  return (
    <nav className="sidebar">
      <button
        className={`tab chapters-tab ${route === "/chapters" || route.startsWith("/chapters/") ? "active" : ""}`}
        onClick={go("/chapters")}
      >
        <img src="/skill-art/chapters.svg" alt="" />
        View Chapter Texts
      </button>
      {error && (
        <div className="sidebar-note">
          <p className="hint err">Couldn't load the skill list — is the server running?</p>
          <button className="btn ghost" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {items.map((s) => {
        const phaseHead =
          s.phase !== lastPhase ? <div className="phase" key={`phase-${s.phase}`}>{phaseLabels[s.phase] ?? s.phase}</div> : null;
        lastPhase = s.phase;
        const active = route === `/skill/${s.skill_id}`;
        return (
          <div key={`${s.phase}-${s.skill_id}`}>
            {phaseHead}
            <button
              className={`tab ${active ? "active" : ""}`}
              onClick={go(`/skill/${s.skill_id}`)}
              title={s.alias ? "Also listed under its home phase" : undefined}
            >
              <img src={s.image_path} alt="" />
              {s.display_name.replace(/ v2$/, "")}
              {/v2$/.test(s.display_name) && <span className="v2">v2</span>}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
