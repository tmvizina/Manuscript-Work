import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../shared/contracts.js";
import { createBookWriterApi, exposeBookWriter, type ContextBridgeLike, type IpcRendererLike } from "./expose.js";

type StubResponse = unknown | ((channel: string, arg: unknown) => unknown | Promise<unknown>);

function ipcStub(response: StubResponse): IpcRendererLike & { calls: Array<[string, unknown]>; listeners: Map<string, (...args: unknown[]) => void> } {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    calls: [],
    listeners,
    invoke: async function (channel: string, arg: unknown) {
      this.calls.push([channel, arg]);
      return typeof response === "function" ? response(channel, arg) : response;
    },
    on(channel, listener) {
      listeners.set(channel, listener);
      return this;
    },
    removeListener(channel) {
      listeners.delete(channel);
      return this;
    },
  };
}

describe("preload exposure", () => {
  it("exposes only the narrow Book Writer API", () => {
    const ipc = ipcStub([]);
    let exposed: unknown;
    const bridge: ContextBridgeLike = { exposeInMainWorld: (_key, api) => (exposed = api) };
    exposeBookWriter(bridge, ipc);
    expect(exposed).toBeDefined();
    expect(exposed).not.toHaveProperty("invoke");
    expect(exposed).not.toHaveProperty("send");
    expect(exposed).toHaveProperty("providers.list");
    expect(exposed).toHaveProperty("providers.cancelAuth");
    expect(exposed).toHaveProperty("projects.list");
    expect(exposed).toHaveProperty("projects.import");
    expect(exposed).toHaveProperty("content.listChapters");
    expect(exposed).toHaveProperty("runs.start");
    expect(exposed).toHaveProperty("search.query");
    expect(exposed).toHaveProperty("settings.get");
  });

  it("validates request arguments before invoking IPC", () => {
    const ipc = ipcStub([]);
    const api = createBookWriterApi(ipc);
    const invalidCalls = [
      () => api.providers.install("invalid" as never, "online"),
      () => api.providers.cancelAuth("invalid" as never),
      () => api.runs.start({ provider: "codex", prompt: "go", model: "" }),
      () => api.search.query({ projectId: "project-1", query: "dragon", scope: "invalid" as never }),
      () => api.search.query({ projectId: "project-1", query: "dragon", limit: 0 }),
      () => api.settings.set("project-1", "bad", Number.NaN),
      () => api.runs.start({ provider: "codex", prompt: "go", command: "unexpected" } as never),
    ];
    for (const invalidCall of invalidCalls) {
      try {
        invalidCall();
        throw new Error("expected request validation to fail");
      } catch (error) {
        expect(error).toMatchObject({ code: "INVALID_ARGUMENT" });
      }
    }
    expect(ipc.calls).toHaveLength(0);
  });

  it("uses allow-listed channels and validates responses", async () => {
    const ipc = ipcStub([{ provider: "claude", status: "ready" }]);
    const api = createBookWriterApi(ipc);
    await expect(api.providers.list()).resolves.toEqual([{ provider: "claude", status: "ready" }]);
    expect(ipc.calls[0][0]).toBe(IPC_CHANNELS.providers.list);
  });

  it("sends only a provider enum for authentication and cancellation", async () => {
    const ipc = ipcStub((channel, arg) => channel === IPC_CHANNELS.providers.auth
      ? { provider: (arg as { provider: "claude" }).provider, status: "authenticated", ok: true, authenticated: true }
      : { provider: (arg as { provider: "claude" }).provider, cancelled: true });
    const api = createBookWriterApi(ipc);
    await expect(api.providers.auth("claude")).resolves.toMatchObject({ authenticated: true });
    await expect(api.providers.cancelAuth("claude")).resolves.toEqual({ provider: "claude", cancelled: true });
    expect(ipc.calls).toEqual([
      [IPC_CHANNELS.providers.auth, { provider: "claude" }],
      [IPC_CHANNELS.providers.authCancel, { provider: "claude" }],
    ]);
  });

  it("merges replay with events arriving during the subscribe handshake and cleans up explicitly", async () => {
    let resolveSubscribe: ((value: unknown) => void) | undefined;
    const subscribeResponse = new Promise<unknown>((resolve) => (resolveSubscribe = resolve));
    const ipc = ipcStub((channel: string, arg: unknown) => {
      if (channel === IPC_CHANNELS.runs.subscribe) return subscribeResponse;
      if (channel === IPC_CHANNELS.runs.unsubscribe) {
        return { subscriptionId: (arg as { subscriptionId: string }).subscriptionId, unsubscribed: true };
      }
      return [];
    });
    const api = createBookWriterApi(ipc);
    const received: number[] = [];
    const subscribing = api.runs.subscribe("run-1", (event) => received.push(event.sequence), { afterSequence: -1 });
    const listener = ipc.listeners.get(IPC_CHANNELS.runs.event);
    expect(listener).toBeDefined();
    listener?.({}, { subscriptionId: "subscription-1", event: { runId: "run-1", provider: "codex", sequence: 1, type: "text_delta", text: "buffered" } });
    listener?.({}, { subscriptionId: "subscription-1", event: { runId: "run-1", provider: "codex", sequence: 2, type: "text_delta", text: "early live event" } });
    resolveSubscribe?.({
      subscriptionId: "subscription-1",
      runId: "run-1",
      replayCursor: 1,
      replayTruncated: false,
      replay: [
        { runId: "run-1", provider: "codex", sequence: 0, type: "run_started" },
        { runId: "run-1", provider: "codex", sequence: 1, type: "text_delta", text: "replayed duplicate" },
      ],
    });
    const subscription = await subscribing;
    expect(subscription).toEqual({ subscriptionId: "subscription-1", runId: "run-1", replayCursor: 1, replayTruncated: false });
    expect(received).toEqual([0, 1, 2]);
    listener?.({}, { subscriptionId: "subscription-1", event: { runId: "run-1", provider: "codex", sequence: 3, type: "text_delta", text: "live" } });
    expect(received).toEqual([0, 1, 2, 3]);

    await expect(api.runs.unsubscribe("subscription-1")).resolves.toEqual({ subscriptionId: "subscription-1", unsubscribed: true });
    expect(ipc.listeners.has(IPC_CHANNELS.runs.event)).toBe(false);
    expect(ipc.calls.map(([channel]) => channel)).toEqual([IPC_CHANNELS.runs.subscribe, IPC_CHANNELS.runs.unsubscribe]);
  });

  it("removes its provisional event listener when subscribe fails", async () => {
    const ipc = ipcStub((channel: string) => {
      if (channel === IPC_CHANNELS.runs.subscribe) throw new Error("subscribe failed");
      return [];
    });
    const api = createBookWriterApi(ipc);
    await expect(api.runs.subscribe("run-1", () => undefined)).rejects.toMatchObject({ code: "INVOKE_FAILED", operation: "runs.subscribe" });
    expect(ipc.listeners.has(IPC_CHANNELS.runs.event)).toBe(false);
  });
});
