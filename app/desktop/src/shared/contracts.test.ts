import { describe, expect, it } from "vitest";
import { BookWriterError, isStructuredError, toStructuredError } from "./errors.js";
import { RUN_REPLAY_LIMIT } from "./contracts.js";
import { assertRunSubscribeRequest, assertRunUnsubscribeRequest, isChapterSummary, isJsonValue, isRunEvent, isRunEventDelivery, isRunSubscriptionAccepted, isWorldDocument, isWorldSummaryList, parseResponse } from "./validation.js";

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

  it("keeps world listings lightweight while validating full world documents separately", () => {
    const summary = { documentId: "world-1", relPath: "world/people.md", title: "People" };
    expect(isWorldSummaryList([summary])).toBe(true);
    expect(isWorldSummaryList([{ ...summary, text: "full contents" }])).toBe(false);
    expect(isWorldDocument({ ...summary, text: "full contents" })).toBe(true);
  });

  it("validates bounded, ordered run subscription replay snapshots", () => {
    const event = { runId: "run-1", provider: "codex", sequence: 0, type: "run_started" };
    const accepted = { subscriptionId: "subscription-1", runId: "run-1", replayCursor: 0, replayTruncated: false, replay: [event] };
    expect(isRunSubscriptionAccepted(accepted)).toBe(true);
    expect(isRunSubscriptionAccepted({ ...accepted, replay: [{ ...event, runId: "run-2" }] })).toBe(false);
    expect(isRunSubscriptionAccepted({ ...accepted, replayCursor: 1 })).toBe(false);
    expect(isRunSubscriptionAccepted({ ...accepted, replay: Array.from({ length: RUN_REPLAY_LIMIT + 1 }, (_, sequence) => ({ ...event, sequence })), replayCursor: RUN_REPLAY_LIMIT })).toBe(false);
    expect(isRunEventDelivery({ subscriptionId: "subscription-1", event })).toBe(true);
    expect(isRunEventDelivery({ subscriptionId: "subscription-1", event, raw: "private" })).toBe(false);
    expect(() => assertRunSubscribeRequest({ runId: "run-1", afterSequence: 1.5 })).toThrowError();
    expect(() => assertRunSubscribeRequest({ runId: "run-1", unsupported: true })).toThrowError();
    expect(() => assertRunUnsubscribeRequest({ subscriptionId: "" })).toThrowError();
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
