import { describe, expect, it } from "vitest";
import { BookWriterError, isStructuredError, toStructuredError } from "./errors.js";
import { isRunEvent, parseResponse } from "./validation.js";

describe("desktop IPC contracts", () => {
  it("serializes structured errors without leaking Error internals", () => {
    const error = new BookWriterError({ code: "INVALID_ARGUMENT", message: "bad request", operation: "runs.start" });
    const serialized = error.toJSON();
    expect(serialized).toEqual({ name: "BookWriterError", code: "INVALID_ARGUMENT", message: "bad request", operation: "runs.start" });
    expect(isStructuredError(serialized)).toBe(true);
    expect(toStructuredError(new Error("boom"), "runs.start")).toMatchObject({ code: "INVOKE_FAILED", operation: "runs.start" });
  });

  it("validates event payloads and supports typed response envelopes", () => {
    const event = {
      runId: "run-1",
      provider: "codex",
      sequence: 0,
      type: "text_delta",
      role: "assistant",
      text: "hello",
    };
    expect(isRunEvent(event)).toBe(true);
    expect(parseResponse({ ok: true, value: event }, isRunEvent, "runs.subscribe")).toEqual(event);
    expect(isRunEvent({ provider: "codex", sequence: 0, type: "text_delta" })).toBe(false);
  });
});
