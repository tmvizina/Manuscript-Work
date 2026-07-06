import type { SkillSummary } from "../lib/api";

export default function Sidebar({
  route,
  skills,
  phaseLabels,
}: {
  route: string;
  skills: SkillSummary[];
  phaseLabels: Record<string, string>;
}) {
  const go = (path: string) => () => {
    location.hash = path;
  };
  let lastPhase = "";

  return (
    <nav className="sidebar">
      <button className={`tab chapters-tab ${route === "/chapters" ? "active" : ""}`} onClick={go("/chapters")}>
        <img src="/skill-art/chapters.svg" alt="" />
        View Chapter Texts
      </button>
      {skills.map((s) => {
        const phaseHead =
          s.phase !== lastPhase ? <div className="phase" key={`phase-${s.phase}`}>{phaseLabels[s.phase] ?? s.phase}</div> : null;
        lastPhase = s.phase;
        const active = route === `/skill/${s.skill_id}`;
        return (
          <div key={s.skill_id}>
            {phaseHead}
            <button className={`tab ${active ? "active" : ""}`} onClick={go(`/skill/${s.skill_id}`)}>
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
