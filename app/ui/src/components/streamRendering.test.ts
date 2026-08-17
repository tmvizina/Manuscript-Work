import { describe, expect, it } from "vitest";
import { appendStreamLines } from "./RunOutput";
import { appendRunEvents } from "../pages/NativeSkillPage";
import type { RunEvent } from "../transport";

describe("stream rendering helpers", () => {
  it("keeps HTTP event-level formatting while appending a batch", () => {
    const result = appendStreamLines(
      [{ kind: "text", text: "hello" }],
      [
        { kind: "text", text: " world" },
        { kind: "tool", text: "ƒs' Read" },
        { kind: "text", text: "done" },
      ],
    );

    expect(result).toEqual([
      { kind: "text", text: "hello" },
      { kind: "text", text: " world" },
      { kind: "tool", text: "ƒs' Read" },
      { kind: "text", text: "done" },
    ]);
  });

  it("coalesces native token deltas while retaining terminal and tool events", () => {
    const event = (sequence: number, type: RunEvent["type"], text?: string): RunEvent => ({
      runId: "run-1",
      provider: "claude",
      sequence,
      type,
      ...(text === undefined ? {} : { text }),
    });

    expect(appendRunEvents([], [
      event(1, "text_delta", "hel"),
      event(2, "text_delta", "lo"),
      event(3, "tool_call"),
      event(4, "text_delta", "!"),
      event(5, "run_completed"),
    ])).toEqual([
      event(2, "text_delta", "hello"),
      event(3, "tool_call"),
      event(4, "text_delta", "!"),
      event(5, "run_completed"),
    ]);
  });
});
