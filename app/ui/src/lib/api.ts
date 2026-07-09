export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `${res.status} ${res.statusText}`);
  return data as T;
}

export interface SkillSummary {
  skill_id: string;
  display_name: string;
  pipeline_order: number;
  phase: string;
  blurb: string;
  image_path: string;
  has_rag_variant: number;
}

export interface ChapterSummary {
  chapter_id: string;
  book: string;
  number: number;
  title: string;
  word_count: number;
}

export interface RunSummary {
  run_id: string;
  variant: string;
  prompt: string;
  status: string;
  result_text: string;
  error: string | null;
  num_turns: number | null;
  total_cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  finished_at: string | null;
}

/** Subscribe to a run's SSE stream. Returns an unsubscribe fn. */
export function streamRun(
  runId: string,
  onEvent: (event: any) => void,
  onDone: () => void,
): () => void {
  const es = new EventSource(`/api/claude/runs/${runId}/events`);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    es.close();
    onDone();
  };
  es.addEventListener("claude", (e) => {
    try {
      onEvent(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore malformed lines */
    }
  });
  es.addEventListener("done", finish);
  let checking = false;
  es.onerror = () => {
    // EventSource auto-reconnects and the server replays the buffer on
    // reattach — but if the server restarted, the live run is gone and the
    // stream would never resolve. Check the run's real status and stop
    // retrying once it's no longer active.
    if (checking || finished) return;
    checking = true;
    api<{ status: string; error?: string | null }>(`/api/claude/runs/${runId}`)
      .then((run) => {
        if (run.status !== "running" && run.status !== "queued") {
          if (run.status === "error") onEvent({ type: "bridge_error", error: run.error ?? "run failed" });
          finish();
        }
      })
      .catch(() => {
        /* server unreachable — let EventSource keep retrying */
      })
      .finally(() => {
        checking = false;
      });
  };
  return () => es.close();
}
