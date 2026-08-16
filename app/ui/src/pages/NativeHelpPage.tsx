const sections = [
  ["Projects and profiles", "Import each manuscript folder once. Fantasy projects use World; practical nonfiction projects use Knowledge Base. The portable .book-writer/project.json file carries that choice with the manuscript."],
  ["Running workflows", "Choose a workflow in the sidebar, describe the scoped task, and select Base or RAG-aware. Native provider execution is intentionally unavailable until Phase 4 onboarding, discovery, and authentication are complete."],
  ["Reviews and plans", "Reviewer output under reviews/ and editing plans under editing-plan/ are read directly from the selected project. Native documents are shown as inert source text."],
  ["Fly and night fishing", "Use the Fly & Night Fishing import preset. Its Knowledge Base separates field experience, techniques, waters, species, equipment, conditions, regulations, safety, interviews, and sources."],
];

export default function NativeHelpPage() {
  return <><h1>Guides</h1><p className="sub">Desktop guidance for the native, project-scoped workflow.</p><div className="help-grid">{sections.map(([title, body], index) => <article className="help-card card" key={title}><span className="n">{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{body}</p></article>)}</div></>;
}
