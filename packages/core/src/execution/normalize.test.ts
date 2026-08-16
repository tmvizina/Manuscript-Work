import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseClaudeJsonl, parseCodexJsonl, parseProviderJsonl } from "./normalize.js";
import type { AuthResult, InstallResult, RunRequest } from "./contracts.js";

function fixture(relativePath: string): string {
  return readFileSync(new URL(`../../../../test/fixtures/streams/${relativePath}`, import.meta.url), "utf8");
}

describe("Claude JSONL normalization", () => {
  it("maps a successful tool-using run to common events", () => {
    const parsed = parseClaudeJsonl(fixture("claude/success.jsonl"));
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.terminal).toBe(true);
    expect(parsed.events.map((event) => event.type)).toEqual([
      "run_started",
      "text_delta",
      "tool_call",
      "tool_result",
      "text_delta",
      "run_completed",
      "stream_ended",
    ]);
    expect(parsed.events.find((event) => event.type === "run_started")).toMatchObject({
      provider: "claude",
      runId: "sess-syn-claude-001",
    });
    expect(parsed.events.find((event) => event.type === "tool_call")).toMatchObject({
      toolCallId: "toolu-syn-001",
      name: "Read",
    });
    expect(parsed.events.find((event) => event.type === "run_completed")).toMatchObject({
      result: "Synthetic continuity note completed.",
      usage: { inputTokens: 412, outputTokens: 97 },
    });
  });

  it("retains provider failures as a normalized failed event", () => {
    const parsed = parseClaudeJsonl(fixture("claude/error.jsonl"));
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.events.find((event) => event.type === "run_failed")).toMatchObject({
      error: { code: "provider_result_error", provider: "claude" },
    });
  });
});

describe("Codex JSONL normalization", () => {
  it("maps thread, reasoning, command, message, and usage events", () => {
    const parsed = parseCodexJsonl(fixture("codex/success.jsonl"));
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.events.map((event) => event.type)).toEqual([
      "run_started",
      "turn_started",
      "reasoning_delta",
      "reasoning_delta",
      "tool_call",
      "tool_result",
      "text_delta",
      "text_delta",
      "text_delta",
      "text_delta",
      "run_completed",
    ]);
    expect(parsed.events.find((event) => event.type === "tool_result")).toMatchObject({
      toolCallId: "item-syn-command-001",
      exitCode: 0,
      status: "completed",
    });
    expect(parsed.events.find((event) => event.type === "run_completed")).toMatchObject({
      usage: { inputTokens: 506, cachedInputTokens: 102, outputTokens: 68 },
    });
  });

  it("normalizes failed turns without throwing", () => {
    const parsed = parseCodexJsonl(fixture("codex/error.jsonl"));
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.events.filter((event) => event.type === "run_failed")).toHaveLength(2);
    expect(parsed.terminal).toBe(true);
  });
});

describe("malformed JSONL", () => {
  it("emits malformed events and keeps later lines parseable", () => {
    const parsed = parseCodexJsonl(fixture("malformed/invalid-json.jsonl"));
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatchObject({ code: "invalid_json", line: 2 });
    expect(parsed.events.find((event) => event.type === "malformed")).toMatchObject({
      error: { code: "invalid_json", line: 2 },
    });
    expect(parsed.events.at(-1)?.type).toBe("run_completed");
  });

  it("ignores blank lines but reports malformed non-blank lines", () => {
    const parsed = parseProviderJsonl("claude", fixture("malformed/mixed-and-blank.jsonl"));
    expect(parsed.lineCount).toBe(8);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.events.filter((event) => event.type === "malformed")).toHaveLength(1);
  });
});

describe("execution contracts", () => {
  it("accepts the shared request and provider result shapes", () => {
    const request: RunRequest = { provider: "codex", prompt: "synthetic prompt", variant: "base" };
    const install: InstallResult = { provider: "codex", status: "already_installed", ok: true, installed: true };
    const auth: AuthResult = { provider: "codex", status: "authenticated", ok: true, authenticated: true };
    expect(request.provider).toBe("codex");
    expect(install.ok && auth.authenticated).toBe(true);
  });
});

