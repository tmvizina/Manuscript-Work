import { describe, expect, it } from "vitest";
import {
  createAgentRun,
  createProject,
  finishAgentRun,
  getAgentRun,
  getProject,
  getProjectChapter,
  getProjectSetting,
  listProjectChapters,
  listProjects,
  markAgentRunStarted,
  openDb,
  openProject,
  putProjectChapter,
  resolveOrphanedAgentRuns,
  setProjectSetting,
} from "./index.js";

function memoryDatabase() {
  return openDb(":memory:");
}

function seedProject(db: ReturnType<typeof memoryDatabase>, projectId: string, rootPath: string, active = true) {
  return createProject(db, { projectId, name: projectId, rootPath, active });
}

function putChapter(db: ReturnType<typeof memoryDatabase>, projectId: string, text: string): void {
  putProjectChapter(db, {
    projectId,
    chapterId: "book-1/Chapter 1 - Arrival.txt",
    book: "book-1",
    relPath: "chapters/Chapter 1 - Arrival.txt",
    number: 1,
    title: "Arrival",
    text,
    sha256: `hash-${projectId}`,
    wordCount: 2,
    active: true,
    fileMtime: "2026-08-16T12:00:00Z",
    syncedAt: "2026-08-16T12:00:00Z",
  });
}

describe("project-scoped persistence", () => {
  it("keeps duplicate chapter IDs and relative paths isolated by project", () => {
    const db = memoryDatabase();
    seedProject(db, "project_one", "./fixtures/project-one");
    seedProject(db, "project_two", "./fixtures/project-two");

    putChapter(db, "project_one", "First manuscript");
    putChapter(db, "project_two", "Second manuscript");

    expect(getProjectChapter(db, "project_one", "book-1/Chapter 1 - Arrival.txt")?.text).toBe("First manuscript");
    expect(getProjectChapter(db, "project_two", "book-1/Chapter 1 - Arrival.txt")?.text).toBe("Second manuscript");
    expect(listProjectChapters(db, "project_one")).toHaveLength(1);
    expect(listProjectChapters(db, "project_two")).toHaveLength(1);
    db.close();
  });

  it("isolates JSON settings and removes project-owned data on delete", () => {
    const db = memoryDatabase();
    seedProject(db, "project_one", "./fixtures/project-one");
    seedProject(db, "project_two", "./fixtures/project-two");
    putChapter(db, "project_one", "First manuscript");

    setProjectSetting(db, "project_one", "ui.preferences", { density: "compact", animations: false });
    setProjectSetting(db, "project_two", "ui.preferences", { density: "comfortable" });

    expect(getProjectSetting(db, "project_one", "ui.preferences")?.value).toEqual({
      density: "compact",
      animations: false,
    });
    expect(getProjectSetting(db, "project_two", "ui.preferences")?.value).toEqual({ density: "comfortable" });

    db.prepare("DELETE FROM projects WHERE project_id = ?").run("project_one");
    expect(getProjectSetting(db, "project_one", "ui.preferences")).toBeNull();
    expect(getProjectChapter(db, "project_one", "book-1/Chapter 1 - Arrival.txt")).toBeNull();
    db.close();
  });

  it("opens only active stored projects and never accepts a replacement path", () => {
    const db = memoryDatabase();
    const active = seedProject(db, "project_active", "./fixtures/trusted-root");
    seedProject(db, "project_inactive", "./fixtures/inactive-root", false);

    expect(listProjects(db)).toHaveLength(1);
    expect(listProjects(db, { includeInactive: true })).toHaveLength(2);
    expect(openProject(db, "project_active")?.rootPath).toBe(active.rootPath);
    expect(openProject(db, "project_inactive")).toBeNull();
    expect(openProject(db, "missing")).toBeNull();
    expect(getProject(db, "project_inactive")?.active).toBe(false);
    db.close();
  });
});
describe("agent run persistence", () => {
  it("records lifecycle transitions and resolves orphaned runs", () => {
    const db = memoryDatabase();
    seedProject(db, "project_one", "./fixtures/project-one");
    const completed = createAgentRun(db, {
      runId: "run_completed",
      projectId: "project_one",
      provider: "codex",
      prompt: "Draft the scene",
    });
    expect(completed.status).toBe("queued");
    expect(markAgentRunStarted(db, completed.runId)).toBe(true);
    expect(finishAgentRun(db, completed.runId, {
      status: "completed",
      resultText: "Done",
      usage: { inputTokens: 12, outputTokens: 5, durationMs: 40 },
    })).toBe(true);
    expect(getAgentRun(db, completed.runId)).toMatchObject({
      status: "completed",
      resultText: "Done",
      usage: { inputTokens: 12, outputTokens: 5, durationMs: 40 },
    });

    createAgentRun(db, { runId: "run_orphan", provider: "claude", prompt: "Continue" });
    expect(resolveOrphanedAgentRuns(db)).toBe(1);
    expect(getAgentRun(db, "run_orphan")).toMatchObject({
      status: "failed",
      error: "interrupted by application restart",
    });
    db.close();
  });
});
