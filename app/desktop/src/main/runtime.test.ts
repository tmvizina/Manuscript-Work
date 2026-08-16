import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject } from "@book-writer/core";
import { afterEach, describe, expect, it } from "vitest";
import { DeterministicFakeRunner } from "./runs/index.js";
import { NativeDesktopRuntime } from "./runtime.js";

const roots: string[] = [];

function testRoot(): string {
  const base = join(process.cwd(), ".tmp-tests");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "desktop-runtime-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("native desktop runtime", () => {
  it("composes trusted content and an injected deterministic runner", async () => {
    const root = testRoot();
    mkdirSync(join(root, "chapters"), { recursive: true });
    writeFileSync(join(root, "chapters", "Chapter 1.5 - Bridge.txt"), "A silver dragon crosses.", "utf8");
    const runner = new DeterministicFakeRunner();
    const runtime = new NativeDesktopRuntime(join(root, "data", "book-writer.db"), { runner });
    createProject(runtime.db, { projectId: "project-1", name: "Project", rootPath: root });

    const opened = runtime.openProject("project-1");
    expect(opened).toMatchObject({ projectId: "project-1", name: "Project" });
    expect(opened).not.toHaveProperty("manuscriptRoot");
    expect(runtime.listChapters("project-1")[0]?.number).toBe(1.5);

    const accepted = await runtime.startRun({ provider: "codex", projectId: "project-1", prompt: "synthetic" });
    const live: string[] = [];
    await runtime.subscribeRun({ runId: accepted.runId }, ({ event }) => {
      if (event.text) live.push(event.text);
    });
    runner.emit(accepted.runId, { type: "text_delta", role: "assistant", text: "safe output", raw: "private" });
    runner.complete(accepted.runId, { resultText: "done" });
    await Promise.resolve();
    await Promise.resolve();

    expect(live).toEqual(["safe output"]);
    expect(await runtime.getRun(accepted.runId)).toMatchObject({ status: "completed", resultText: "done" });
    await runtime.close();
  });

  it("keeps real provider execution unavailable until a runner is configured", async () => {
    const root = testRoot();
    const runtime = new NativeDesktopRuntime(join(root, "data", "book-writer.db"));
    await expect(runtime.startRun({ provider: "claude", prompt: "must not run" })).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
    const failed = runtime.db.prepare("SELECT status FROM agent_runs").get() as { status: string };
    expect(failed.status).toBe("failed");
    await runtime.close();
  });
});
