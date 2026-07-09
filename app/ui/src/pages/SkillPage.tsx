import { useEffect, useState } from "react";
import { api, type RunSummary } from "../lib/api";
import RunOutput from "../components/RunOutput";

export default function SkillPage({ skillId, bridgeOk }: { skillId: string; bridgeOk: boolean }) {
  const [skill, setSkill] = useState<any>(null);
  const [prompt, setPrompt] = useState("");
  const [variant, setVariant] = useState<"base" | "rag">("base");
  const [mode, setMode] = useState("acceptEdits");
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    api(`/api/skills/${skillId}`).then((s) => {
      setSkill(s);
      return s;
    });
  useEffect(() => {
    load()
      .then((s) => {
        // A run may still be in flight from before a reload or navigation —
        // reattach to it (the server replays the event buffer on the SSE stream).
        const latest = (s.runs as RunSummary[] | undefined)?.[0];
        if (latest && (latest.status === "running" || latest.status === "queued")) {
          setActiveRun((cur) => cur ?? latest.run_id);
        }
      })
      .catch(() => setSkill({ missing: true }));
  }, [skillId]);

  if (!skill) return <p className="hint">Loading…</p>;
  if (skill.missing) return <p className="err">Unknown skill: {skillId}</p>;

  const run = async () => {
    setError("");
    try {
      const r = await api<{ run_id: string }>("/api/claude/run", {
        method: "POST",
        body: JSON.stringify({ skill_id: skillId, variant, prompt, permission_mode: mode }),
      });
      setActiveRun(r.run_id);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const command = `/${skillId}${variant === "rag" ? "-rag" : ""}`;

  return (
    <>
      <div className="skill-head">
        <img src={skill.image_path} alt="" />
        <div>
          <h1>{skill.display_name}</h1>
          <p className="sub">{skill.blurb}</p>
          {skill.description && (
            <details className="desc">
              <summary>Full description</summary>
              <p>{skill.description}</p>
            </details>
          )}
        </div>
      </div>

      <div className="card runbox">
        <label className="hint" htmlFor="prompt">
          Runs as <code>{command}</code> {skill.argument_hint && <>— arguments: {skill.argument_hint}</>}
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`What should ${skill.display_name} do? e.g. ${skill.argument_hint || "describe the task"}`}
        />
        <div className="controls">
          {!!skill.has_rag_variant && (
            <span className="variant-toggle" title="RAG-aware: canon lookups go through the RAG index to save tokens">
              <button className={variant === "base" ? "on" : ""} onClick={() => setVariant("base")}>
                Base
              </button>
              <button className={variant === "rag" ? "on" : ""} onClick={() => setVariant("rag")}>
                RAG-aware
              </button>
            </span>
          )}
          <select value={mode} onChange={(e) => setMode(e.target.value)} title="Claude permission mode">
            <option value="acceptEdits">acceptEdits — auto-accept file edits</option>
            <option value="default">default — edits require pre-approval</option>
            <option value="plan">plan — read-only planning</option>
          </select>
          <button className="btn" onClick={run} disabled={!prompt.trim() || !bridgeOk || !!activeRun}>
            Run
          </button>
          {!bridgeOk && (
            <span className="hint err">
              Bridge offline — start it in an IDE terminal (<a href="#/help/bridge">Help → Claude Bridge</a>)
            </span>
          )}
          {error && <span className="err">{error}</span>}
        </div>
        {activeRun && (
          <RunOutput
            runId={activeRun}
            onFinished={() => {
              setActiveRun(null);
              load().catch(() => {});
            }}
          />
        )}
      </div>

      <div className="runs">
        <h3>Run history</h3>
        {(!skill.runs || skill.runs.length === 0) && <p className="hint">No runs yet for this skill.</p>}
        {(skill.runs as RunSummary[])?.map((r) => (
          <details className="run-item" key={r.run_id}>
            <summary>
              <span className={`chip ${r.status}`}>{r.status}</span>
              {r.variant === "rag" && <span className="chip rag">RAG</span>}
              <span className="prompt-preview">{r.prompt}</span>
              <span className="when">
                {r.total_cost_usd != null && <>${r.total_cost_usd.toFixed(2)} · </>}
                {new Date(r.created_at).toLocaleString()}
              </span>
            </summary>
            {r.error && <div className="run-result err">{r.error}</div>}
            {r.result_text && <div className="run-result">{r.result_text}</div>}
          </details>
        ))}
      </div>
    </>
  );
}
