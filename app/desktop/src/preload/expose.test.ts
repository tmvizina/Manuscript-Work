import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../shared/contracts.js";
import { createBookWriterApi, exposeBookWriter, type ContextBridgeLike, type IpcRendererLike } from "./expose.js";

function ipcStub(response: unknown): IpcRendererLike & { calls: Array<[string, unknown]>; listeners: Map<string, (...args: unknown[]) => void> } {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    calls: [],
    listeners,
    invoke: async function (channel: string, arg: unknown) {
      this.calls.push([channel, arg]);
      return response;
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
    expect(exposed).toHaveProperty("projects.list");
    expect(exposed).toHaveProperty("content.listChapters");
    expect(exposed).toHaveProperty("runs.start");
    expect(exposed).toHaveProperty("search.query");
    expect(exposed).toHaveProperty("settings.get");
  });

  it("validates request arguments before invoking IPC", () => {
    const ipc = ipcStub([]);
    const api = createBookWriterApi(ipc);
    const invalidCalls = [
      () => api.providers.install("invalid" as never),
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

  it("filters run events by run id and returns an unsubscribe function", () => {
    const ipc = ipcStub([]);
    const api = createBookWriterApi(ipc);
    const received: string[] = [];
    const unsubscribe = api.runs.subscribe("run-1", (event) => received.push(event.runId));
    const listener = ipc.listeners.get(IPC_CHANNELS.runs.event);
    listener?.({}, { runId: "run-2", provider: "codex", sequence: 0, type: "text_delta", text: "ignore" });
    listener?.({}, { runId: "run-1", provider: "codex", sequence: 1, type: "text_delta", text: "keep" });
    expect(received).toEqual(["run-1"]);
    unsubscribe();
    expect(ipc.listeners.has(IPC_CHANNELS.runs.event)).toBe(false);
  });
});
