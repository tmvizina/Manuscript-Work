import { useEffect, useMemo, useState } from "react";
import type { SkillSummary } from "../lib/api";
import { createBufferedBatch } from "../lib/bufferedBatch";
import { renderMarkdown } from "../lib/markdown";
import type { BookWriterTransport, ExecutionProvider, PermissionMode, RunEvent, RunRecord, RunVariant } from "../transport";

const active = (status: RunRecord["status"]) => status === "queued" || status === "starting" || status === "running";

/** Keep token streams readable without creating one DOM node per token. */
export function appendRunEvents(previous: RunEvent[], incoming: readonly RunEvent[]): RunEvent[] {
  const next = [...previous];
  for (const event of incoming) {
    const last = next[next.length - 1];
    if (
      (event.type === "text_delta" || event.type === "reasoning_delta") &&
      last?.type === event.type &&
      typeof event.text === "string" &&
      typeof last.text === "string"
    ) {
      next[next.length - 1] = { ...last, sequence: event.sequence, text: `${last.text}${event.text}` };
    } else {
      next.push(event);
    }
  }
  return next;
}

export default function NativeSkillPage({ transport, projectId, skill }: { transport: BookWriterTransport; projectId?: string; skill?: SkillSummary }) {
  const [prompt, setPromptState] = useState(() => skill ? sessionStorage.getItem(`bw-draft-${skill.skill_id}`) ?? "" : "");
  const [variant, setVariant] = useState<RunVariant>("base");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("acceptEdits");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<ExecutionProvider | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const current = useMemo(() => runs.find((run) => active(run.status)), [runs]);
  const setPrompt = (value: string) => { setPromptState(value); if (skill) sessionStorage.setItem(`bw-draft-${skill.skill_id}`, value); };
  const load = () => projectId && skill ? transport.runs.list({ projectId, skillId: skill.skill_id, limit: 20 }).then(setRuns) : Promise.resolve();

  useEffect(() => { setEvents([]); setError(""); void load().catch((reason) => setError(String(reason?.message ?? reason))); }, [projectId, skill?.skill_id]);
  useEffect(() => {
    if (!projectId) return;
    Promise.all([transport.settings.get(projectId, "preferredProvider"), transport.providers.status()]).then(([record, statuses]) => {
      const selected = record?.value === "claude" || record?.value === "codex" ? record.value : null;
      setProvider(selected);
      setProviderReady(selected !== null && statuses.some((status) => status.provider === selected && status.status === "ready"));
    }).catch((reason) => setError(String(reason?.message ?? reason)));
  }, [projectId, transport]);
  useEffect(() => {
    if (!current) return;
    let subscriptionId = "";
    let disposed = false;
    const seenSequences = new Set<number>();
    const bufferedEvents = createBufferedBatch<RunEvent>((batch) => {
      if (disposed) return;
      setEvents((previous) => {
        const unique = batch.filter((event) => {
          if (seenSequences.has(event.sequence)) return false;
          seenSequences.add(event.sequence);
          return true;
        });
        return unique.length ? appendRunEvents(previous, unique) : previous;
      });
    });
    transport.runs.subscribe(current.runId, (event) => {
      if (disposed) return;
      bufferedEvents.push(event);
      if (["run_completed", "run_failed", "stream_ended"].includes(event.type)) void load();
    }, undefined, (reason) => setError(reason.message)).then((subscription) => { subscriptionId = subscription.subscriptionId; if (disposed) void transport.runs.unsubscribe(subscriptionId); }).catch((reason) => setError(String(reason?.message ?? reason)));
    return () => { disposed = true; bufferedEvents.dispose(); if (subscriptionId) void transport.runs.unsubscribe(subscriptionId); };
  }, [current?.runId]);

  if (!skill) return <p className="err">Unknown skill.</p>;
  if (!projectId) return <p className="hint">Select or import a project first.</p>;

  const start = async () => {
    setError(""); setEvents([]);
    try {
      if (!provider || !providerReady) throw new Error("Choose a detected provider before starting a run.");
      await transport.runs.start({ provider, projectId, skillId: skill.skill_id, variant, permissionMode, prompt: `/${skill.skill_id}${variant === "rag" ? "-rag" : ""} ${prompt}`.trim() });
    } catch (reason: any) {
      setError(String(reason?.message ?? reason));
    } finally {
      await load().catch(() => undefined);
    }
  };

  return <>
    <div className="skill-head"><img src={skill.image_path} alt="" /><div><h1>{skill.display_name}</h1><p className="sub">{skill.blurb}</p></div></div>
    <div className="card runbox">
      <label className="hint" htmlFor="native-prompt">Runs as <code>/{skill.skill_id}{variant === "rag" ? "-rag" : ""}</code></label>
      <textarea id="native-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the work for this project." />
      <div className="controls">
        <span className="variant-toggle"><button className={variant === "base" ? "on" : ""} onClick={() => setVariant("base")}>Base</button><button className={variant === "rag" ? "on" : ""} onClick={() => setVariant("rag")}>RAG-aware</button></span>
        <select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as PermissionMode)}><option value="acceptEdits">acceptEdits</option><option value="default">default</option><option value="plan">plan</option></select>
        <button className="btn" disabled={!prompt.trim() || !!current || !providerReady} onClick={start}>Run</button>
        {current && <button className="btn danger" onClick={() => transport.runs.cancel(current.runId).then(load)}>Cancel</button>}
      </div>
      <p className="hint">{providerReady ? `${provider} is authenticated and ready for native execution.` : <>Choose and authenticate an installed CLI in <a href="#/providers">Provider setup</a> before running workflows.</>}</p>
      {error && <p className="err">{error}</p>}
      {events.length > 0 && <div className="stream">{events.map((event) => <p className="txt" key={event.sequence}>{event.text ?? event.result ?? event.output ?? event.error?.message ?? event.type}</p>)}</div>}
    </div>
    <div className="runs"><h3>Run history</h3>{runs.length === 0 && <p className="hint">No native runs yet for this skill.</p>}{runs.map((run) => <details className="run-item" key={run.runId}><summary><span className={`chip ${run.status}`}>{run.status}</span><span className="prompt-preview">{run.prompt}</span><span className="when">{run.usage?.totalCostUsd != null && <>${run.usage.totalCostUsd.toFixed(2)} · </>}{new Date(run.createdAt).toLocaleString()}</span></summary>{run.error && <pre className="run-result err">{run.error}</pre>}{run.resultText && <div className="run-result md help-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(run.resultText) }} />}<div className="run-actions"><button className="btn ghost" onClick={() => setPrompt(run.prompt.replace(new RegExp(`^/${skill.skill_id}(?:-rag)?\\s*`), ""))}>Use prompt</button></div></details>)}</div>
  </>;
}
