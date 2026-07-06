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
  es.addEventListener("claude", (e) => {
    try {
      onEvent(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore malformed lines */
    }
  });
  es.addEventListener("done", () => {
    es.close();
    onDone();
  });
  es.onerror = () => {
    // EventSource auto-reconnects; the server replays the buffer on reattach.
  };
  return () => es.close();
}
