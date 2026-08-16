import type { IpcMainInvokeEvent, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS, type IpcResponse, type RunEventDelivery } from "../shared/contracts.js";
import { registerIpcHandlers, type DesktopRuntime, type RegisterIpcOptions } from "./ipc.js";

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown;

function runtime(overrides: Partial<DesktopRuntime> = {}): DesktopRuntime {
  return {
    listProviders: () => [],
    getProviderStatus: () => [],
    authenticateProvider: (provider) => ({ provider, status: "authenticated", ok: true, authenticated: true }),
    cancelProviderAuthentication: (provider) => ({ provider, cancelled: false }),
    listProjects: () => [],
    getProject: () => null,
    openProject: (projectId) => ({ projectId, name: "Project", rootPath: "C:/project", active: true }),
    importProject: (rootPath) => ({ projectId: "project-imported", name: "Imported", rootPath, active: true }),
    listChapters: () => [],
    getChapter: (_projectId, chapterId) => ({ chapterId, book: "book-1", relPath: "chapters/one.txt", number: 1, title: "One", wordCount: 1, active: true, text: "one" }),
    listWorld: () => [],
    getWorld: (_projectId, relPath) => ({ documentId: `world:${relPath}`, relPath, text: "world" }),
    startRun: (request) => ({ runId: "run-1", provider: request.provider, status: "queued" }),
    getRun: (runId) => ({ runId, provider: "claude", variant: "base", status: "queued", prompt: "test", createdAt: "2026-08-16T00:00:00Z" }),
    cancelRun: (runId) => ({ runId, cancelled: false }),
    subscribeRun: (request) => ({ subscriptionId: "subscription-1", runId: request.runId, replayCursor: request.afterSequence ?? -1, replayTruncated: false, replay: [] }),
    unsubscribeRun: (subscriptionId) => ({ subscriptionId, unsubscribed: true }),
    search: () => [],
    getSetting: () => null,
    setSetting: (projectId, key, value) => ({ projectId, key, value, updatedAt: "2026-08-16T00:00:00Z" }),
    ...overrides,
  };
}

function harness(runtimeValue = runtime(), pickProjectRoot?: () => Promise<string | null>) {
  const handlers = new Map<string, Handler>();
  const sent: Array<{ channel: string; value: unknown }> = [];
  let destroyed = false;
  const frame = { url: "book-writer://app/index.html" };
  const webContents = {
    mainFrame: frame,
    isDestroyed: () => destroyed,
    send: (channel: string, value: unknown) => sent.push({ channel, value }),
  } as unknown as WebContents;
  const event = { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const ipcMain: RegisterIpcOptions["ipcMain"] = {
    handle: (channel, handler) => {
      if (handlers.has(channel)) throw new Error(`duplicate ${channel}`);
      handlers.set(channel, handler as Handler);
    },
    removeHandler: (channel) => {
      handlers.delete(channel);
    },
  };
  const dispose = registerIpcHandlers({
    ipcMain,
    webContents,
    runtime: runtimeValue,
    isAllowedFrameUrl: (url) => url.startsWith("book-writer://app/"),
    allowedSettingKeys: new Set(["preferredProvider"]),
    pickProjectRoot,
  });
  const invokeArgs = async (channel: string, args: unknown[], invokeEvent = event): Promise<IpcResponse<unknown>> => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`missing ${channel}`);
    return await handler(invokeEvent, ...args) as IpcResponse<unknown>;
  };
  const invoke = (channel: string, request?: unknown, invokeEvent = event) =>
    invokeArgs(channel, request === undefined ? [] : [request], invokeEvent);
  return { dispose, event, frame, handlers, invoke, invokeArgs, sent, setDestroyed: (value: boolean) => { destroyed = value; }, webContents };
}

describe("desktop IPC boundary", () => {
  it("imports only a main-process-selected project root", async () => {
    const importProject = vi.fn((rootPath: string) => ({ projectId: "project-imported", name: "Imported", rootPath, active: true }));
    const test = harness(runtime({ importProject }), async () => "C:/trusted/fishing-book");
    expect(await test.invoke(IPC_CHANNELS.projects.import, { profile: "nonfiction", preset: "fly-night-fishing" })).toMatchObject({ ok: true, value: { rootPath: "C:/trusted/fishing-book" } });
    expect(importProject).toHaveBeenCalledWith("C:/trusted/fishing-book", { profile: "nonfiction", preset: "fly-night-fishing" });
    expect(await test.invoke(IPC_CHANNELS.projects.import, { profile: "nonfiction", preset: "fly-night-fishing", rootPath: "C:/untrusted" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    test.dispose();
  });

  it("accepts only the configured application main frame", async () => {
    const test = harness();
    expect(await test.invoke(IPC_CHANNELS.projects.list)).toEqual({ ok: true, value: [] });

    const otherFrame = { url: "book-writer://app/index.html" };
    const response = await test.invoke(
      IPC_CHANNELS.projects.list,
      undefined,
      { sender: test.webContents, senderFrame: otherFrame } as unknown as IpcMainInvokeEvent,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });

    expect(await test.invoke(
      IPC_CHANNELS.projects.list,
      undefined,
      { sender: {} as WebContents, senderFrame: test.frame } as unknown as IpcMainInvokeEvent,
    )).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });
    expect(await test.invoke(
      IPC_CHANNELS.projects.list,
      undefined,
      { sender: test.webContents, senderFrame: null } as unknown as IpcMainInvokeEvent,
    )).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });

    test.frame.url = "https://example.invalid/";
    expect(await test.invoke(IPC_CHANNELS.projects.list)).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });
    test.frame.url = "book-writer://app/index.html";
    test.setDestroyed(true);
    expect(await test.invoke(IPC_CHANNELS.projects.list)).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });
    test.dispose();
  });

  it("revalidates requests, setting keys, and runtime responses", async () => {
    const invalidRuntime = runtime({
      listProjects: () => [{ projectId: "project-1", name: "Broken", rootPath: "C:/project", active: "yes" as never }],
    });
    const test = harness(invalidRuntime);
    expect(await test.invoke(IPC_CHANNELS.projects.get, { projectId: "" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(await test.invoke(IPC_CHANNELS.settings.get, { projectId: "project-1", key: "arbitrary" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(await test.invoke(IPC_CHANNELS.settings.set, { projectId: "project-1", key: "preferredProvider", value: "unknown" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(await test.invokeArgs(IPC_CHANNELS.projects.get, [{ projectId: "project-1" }, "extra"])).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(await test.invoke(IPC_CHANNELS.projects.list)).toMatchObject({ ok: false, error: { code: "INVALID_RESPONSE" } });
    test.dispose();
  });

  it("keeps provider installation unavailable and forwards allow-listed authentication", async () => {
    const authenticateProvider = vi.fn((provider: "claude" | "codex") => ({ provider, status: "authenticated" as const, ok: true, authenticated: true }));
    const test = harness(runtime({ authenticateProvider }));
    expect(await test.invoke(IPC_CHANNELS.providers.install, { provider: "claude" })).toMatchObject({ ok: false, error: { code: "FEATURE_UNAVAILABLE" } });
    expect(await test.invoke(IPC_CHANNELS.providers.auth, { provider: "codex" })).toEqual({ ok: true, value: { provider: "codex", status: "authenticated", ok: true, authenticated: true } });
    expect(authenticateProvider).toHaveBeenCalledWith("codex");
    expect(await test.invoke(IPC_CHANNELS.providers.auth, { provider: "codex", executablePath: "C:/untrusted.exe" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(await test.invoke(IPC_CHANNELS.providers.authCancel, { provider: "codex" })).toEqual({ ok: true, value: { provider: "codex", cancelled: false } });
    test.dispose();
  });

  it("forwards an event emitted before subscription snapshot resolution", async () => {
    const event: RunEventDelivery = {
      subscriptionId: "subscription-early",
      event: { runId: "run-1", provider: "claude", sequence: 0, type: "run_started" },
    };
    const unsubscribeRun = vi.fn((subscriptionId: string) => ({ subscriptionId, unsubscribed: true }));
    const test = harness(runtime({
      subscribeRun: (request, deliver) => {
        deliver(event);
        return { subscriptionId: event.subscriptionId, runId: request.runId, replayCursor: 0, replayTruncated: false, replay: [event.event] };
      },
      unsubscribeRun,
    }));

    expect(await test.invoke(IPC_CHANNELS.runs.subscribe, { runId: "run-1" })).toMatchObject({ ok: true, value: { subscriptionId: "subscription-early" } });
    expect(test.sent).toEqual([{ channel: IPC_CHANNELS.runs.event, value: { ok: true, value: event } }]);
    test.dispose();
    expect(unsubscribeRun).toHaveBeenCalledWith("subscription-early");
  });

  it("sanitizes unexpected service errors and removes all handlers on disposal", async () => {
    const test = harness(runtime({ listProjects: () => { throw new Error("C:/private/manuscript.db"); } }));
    const response = await test.invoke(IPC_CHANNELS.projects.list);
    expect(response).toMatchObject({ ok: false, error: { code: "INVOKE_FAILED", message: "The desktop operation failed" } });
    expect(JSON.stringify(response)).not.toContain("private/manuscript");
    test.dispose();
    expect(test.handlers.size).toBe(0);
  });

  it("cleans a subscription that resolves after its renderer is disposed", async () => {
    let resolveSubscribe!: (value: Awaited<ReturnType<DesktopRuntime["subscribeRun"]>>) => void;
    const unsubscribeRun = vi.fn((subscriptionId: string) => ({ subscriptionId, unsubscribed: true }));
    const test = harness(runtime({
      subscribeRun: () => new Promise((resolve) => { resolveSubscribe = resolve; }),
      unsubscribeRun,
    }));
    const pending = test.invoke(IPC_CHANNELS.runs.subscribe, { runId: "run-1" });
    test.dispose();
    resolveSubscribe({ subscriptionId: "subscription-late", runId: "run-1", replayCursor: -1, replayTruncated: false, replay: [] });
    expect(await pending).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });
    expect(unsubscribeRun).toHaveBeenCalledWith("subscription-late");
  });

  it("cleans a subscription ID returned in a malformed acceptance", async () => {
    const unsubscribeRun = vi.fn((subscriptionId: string) => ({ subscriptionId, unsubscribed: true }));
    const test = harness(runtime({
      subscribeRun: () => ({ subscriptionId: "subscription-invalid", runId: "wrong-run" } as never),
      unsubscribeRun,
    }));
    expect(await test.invoke(IPC_CHANNELS.runs.subscribe, { runId: "run-1" })).toMatchObject({ ok: false, error: { code: "INVALID_RESPONSE" } });
    expect(unsubscribeRun).toHaveBeenCalledWith("subscription-invalid");
    test.dispose();
  });
});
