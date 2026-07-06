/** In-memory job registry so the UI has one polling surface for long ops
 * (rag ingest). Trimmed from Audio-Forge's jobsStore — durable state lands in
 * SQLite; jobs themselves are re-runnable. */
import { newId } from "./db/db.js";

export interface ServerJob {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message: string;
  result: any;
  error: string | null;
  created_at: string;
}

const jobs = new Map<string, ServerJob>();

export function createServerJob(
  kind: string,
  fn: (update: (progress: number, message: string) => void) => Promise<any>,
): ServerJob {
  const job: ServerJob = {
    id: newId("job"),
    kind,
    status: "queued",
    progress: 0,
    message: "queued",
    result: null,
    error: null,
    created_at: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  const update = (progress: number, message: string) => {
    if (job.status === "running") {
      job.progress = Math.max(0, Math.min(1, progress));
      job.message = message.slice(0, 300);
    }
  };
  (async () => {
    job.status = "running";
    job.message = "running";
    try {
      job.result = await fn(update);
      job.status = "done";
      job.progress = 1;
      job.message = "done";
    } catch (e: any) {
      job.status = "error";
      job.error = String(e?.message ?? e);
      job.message = job.error.slice(0, 300);
    }
  })();
  return job;
}

export function getServerJob(id: string): ServerJob | undefined {
  return jobs.get(id);
}
