import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject } from "@book-writer/core";
import { afterEach, describe, expect, it } from "vitest";
import { DeterministicFakeRunner } from "./runs/index.js";
import { NativeDesktopRuntime } from "./runtime.js";
import { ProviderDiscovery } from "./providers/discovery.js";

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
  it("discovers providers through an injected main-process service", async () => {
    const root = testRoot();
    const providerDiscovery = new ProviderDiscovery({
      environment: { platform: "win32", path: "C:\\Tools", pathExt: ".EXE" },
      isFile: (path) => path === "C:\\Tools\\codex.exe",
      canonicalize: (path) => path,
      probeVersion: async () => ({ stdout: "codex 1.0.0", stderr: "" }),
      probeAuthentication: async () => false,
    });
    const runtime = new NativeDesktopRuntime(join(root, "data", "book-writer.db"), { providerDiscovery });
    await expect(runtime.listProviders()).resolves.toEqual([
      expect.objectContaining({ provider: "claude", status: "not_installed" }),
      expect.objectContaining({ provider: "codex", status: "auth_required", version: "codex 1.0.0" }),
    ]);
    await runtime.close();
  });

  it("composes trusted content and an injected deterministic runner", async () => {
    const root = testRoot();
    mkdirSync(join(root, "chapters"), { recursive: true });
    mkdirSync(join(root, "reviews"), { recursive: true });
    writeFileSync(join(root, "chapters", "Chapter 1.5 - Bridge.txt"), "A silver dragon crosses.", "utf8");
    writeFileSync(join(root, "reviews", "2026-08-16-project.md"), "# Project review\n\n### RV-001\nFinding.", "utf8");
    const runner = new DeterministicFakeRunner();
    const runtime = new NativeDesktopRuntime(join(root, "data", "book-writer.db"), { runner });
    createProject(runtime.db, { projectId: "project-1", name: "Project", rootPath: root });

    const opened = runtime.openProject("project-1");
    expect(opened).toMatchObject({ projectId: "project-1", name: "Project" });
    expect(opened).not.toHaveProperty("manuscriptRoot");
    expect(runtime.listChapters("project-1")[0]?.number).toBe(1.5);
    expect(runtime.listReviews("project-1")[0]).toMatchObject({ relPath: "reviews/2026-08-16-project.md", kind: "review" });
    expect(runtime.getReview("project-1", "reviews/2026-08-16-project.md").text).toContain("RV-001");

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
    expect(runtime.listRuns({ projectId: "project-1" }).map((run) => run.runId)).toContain(accepted.runId);
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

  it("imports and scaffolds a fishing project with its portable profile", async () => {
    const dataRoot = testRoot();
    const manuscriptRoot = testRoot();
    const runtime = new NativeDesktopRuntime(join(dataRoot, "book-writer.db"));
    const imported = runtime.importProject(manuscriptRoot, { profile: "nonfiction", preset: "fly-night-fishing" });
    expect(imported).toMatchObject({ profile: { profile: "nonfiction", memoryLabel: "Knowledge Base" }, profileSource: "project" });
    expect(existsSync(join(manuscriptRoot, "world", "claims", "claims-ledger.md"))).toBe(true);
    expect(readFileSync(join(manuscriptRoot, ".book-writer", "project.json"), "utf-8")).toContain("fly-night-fishing");
    await runtime.close();
  });
});
