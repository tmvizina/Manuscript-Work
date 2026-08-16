import { describe, expect, it } from "vitest";
import { BookWriterError, isStructuredError, toStructuredError } from "./errors.js";
import { isChapterSummary, isJsonValue, isRunEvent, parseResponse } from "./validation.js";

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
    expect(isRunEvent({ ...event, sequence: Number.NaN })).toBe(false);
    expect(isRunEvent({ ...event, role: "operator" })).toBe(false);
    expect(isRunEvent({ ...event, error: { name: "BookWriterError", code: "FAILED", message: "no", retryable: "yes" } })).toBe(false);
    expect(isRunEvent({ ...event, rawProviderPayload: { secret: true } })).toBe(false);
  });

  it("does not confuse raw results containing ok with response envelopes", () => {
    const installResult = { provider: "codex", status: "installed", ok: true, installed: true };
    expect(parseResponse(installResult, (value): value is typeof installResult => value === installResult, "providers.install")).toBe(installResult);
  });

  it("rejects non-JSON numbers and cyclic values", () => {
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isJsonValue(cyclic)).toBe(false);
  });

  it("accepts decimal chapter numbers used by interstitial chapters", () => {
    expect(isChapterSummary({ chapterId: "chapter-1-5", book: "1", relPath: "chapter-1-5.txt", number: 1.5, title: "Interlude", wordCount: 100, active: true })).toBe(true);
  });

  it("sanitizes structured error objects at the trust boundary", () => {
    const error = toStructuredError({
      name: "BookWriterError",
      code: "FAILED",
      message: "safe",
      operation: "runs.start",
      secret: "must not cross",
    });
    expect(error).toEqual({ name: "BookWriterError", code: "FAILED", message: "safe", operation: "runs.start" });
    expect(error).not.toHaveProperty("secret");
    expect(isStructuredError({ ...error, secret: "must not cross" })).toBe(false);
    expect(isStructuredError({ ...error, retryable: "yes" })).toBe(false);
  });
});
