import type {
  ExecutionError,
  ExecutionProvider,
  MalformedEvent,
  ProviderStatus,
  RunCompletedEvent,
  RunEvent,
  RunFailedEvent,
  RunUsage,
  ToolCallEvent,
  ToolResultEvent,
} from "./contracts.js";

export interface NormalizeContext {
  sequence?: number;
  line?: number;
  rawLine?: string;
}

export interface ParseIssue {
  provider: ExecutionProvider;
  line: number;
  code: "invalid_json" | "invalid_event";
  message: string;
  rawLine: string;
}

export interface ParsedRunStream {
  provider: ExecutionProvider;
  events: RunEvent[];
  issues: ParseIssue[];
  lineCount: number;
  terminal: boolean;
}

type JsonObject = Record<string, any>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return asNumber(value);
}

function errorFor(
  provider: ExecutionProvider,
  code: string,
  message: string,
  context: NormalizeContext = {},
  cause?: unknown,
): ExecutionError {
  return {
    code,
    message,
    provider,
    ...(context.line === undefined ? {} : { line: context.line }),
    ...(cause === undefined ? {} : { cause }),
  };
}

function base(provider: ExecutionProvider, context: NormalizeContext, raw: unknown): {
  provider: ExecutionProvider;
  sequence: number;
  line?: number;
  raw: unknown;
} {
  return {
    provider,
    sequence: context.sequence ?? 0,
    ...(context.line === undefined ? {} : { line: context.line }),
    raw,
  };
}

function usageFrom(value: unknown): RunUsage | undefined {
  const usage = asObject(value);
  if (!usage) return undefined;
  const result: RunUsage = {};
  const inputTokens = asNumber(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = asNumber(usage.output_tokens ?? usage.outputTokens);
  const cachedInputTokens = asNumber(usage.cached_input_tokens ?? usage.cachedInputTokens);
  const totalTokens = asNumber(usage.total_tokens ?? usage.totalTokens);
  const durationMs = asNumber(usage.duration_ms ?? usage.durationMs);
  const durationApiMs = asNumber(usage.duration_api_ms ?? usage.durationApiMs);
  const totalCostUsd = asNumber(usage.total_cost_usd ?? usage.totalCostUsd);
  const numTurns = asNumber(usage.num_turns ?? usage.numTurns);
  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (cachedInputTokens !== undefined) result.cachedInputTokens = cachedInputTokens;
  if (totalTokens !== undefined) result.totalTokens = totalTokens;
  if (durationMs !== undefined) result.durationMs = durationMs;
  if (durationApiMs !== undefined) result.durationApiMs = durationApiMs;
  if (totalCostUsd !== undefined) result.totalCostUsd = totalCostUsd;
  if (numTurns !== undefined) result.numTurns = numTurns;
  return Object.keys(result).length ? result : undefined;
}

function malformed(
  provider: ExecutionProvider,
  rawLine: string,
  message: string,
  context: NormalizeContext,
  code = "invalid_event",
): MalformedEvent {
  return {
    ...base(provider, context, undefined),
    type: "malformed",
    rawLine,
    error: errorFor(provider, code, message, context),
  };
}

function textFrom(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        const object = asObject(part);
        return object ? asString(object.text ?? object.content) ?? "" : "";
      })
      .join("");
  }
  return "";
}

function resultMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value) return value;
  const object = asObject(value);
  if (object && typeof object.message === "string" && object.message) return object.message;
  return fallback;
}

function claudeMessageEvent(raw: JsonObject, context: NormalizeContext): RunEvent[] {
  const message = asObject(raw.message);
  if (!message) return [malformed("claude", context.rawLine ?? JSON.stringify(raw), "assistant event has no message object", context)];
  const content = Array.isArray(message.content) ? message.content : [message.content];
  const events: RunEvent[] = [];
  for (const blockValue of content) {
    const block = asObject(blockValue);
    if (!block) continue;
    const blockType = asString(block.type);
    if (blockType === "text") {
      events.push({
        ...base("claude", context, raw),
        type: "text_delta",
        role: "assistant",
        text: asString(block.text) ?? "",
        delta: false,
        final: false,
      });
    } else if (blockType === "tool_use") {
      const event: ToolCallEvent = {
        ...base("claude", context, raw),
        type: "tool_call",
        toolCallId: asString(block.id),
        name: asString(block.name),
        input: block.input,
        status: "requested",
      };
      events.push(event);
    } else if (blockType) {
      events.push({
        ...base("claude", context, raw),
        type: "unknown",
        sourceType: `assistant.content.${blockType}`,
        data: block,
      });
    }
  }
  return events.length
    ? events
    : [malformed("claude", context.rawLine ?? JSON.stringify(raw), "assistant event has no supported content blocks", context)];
}

function claudeUserEvent(raw: JsonObject, context: NormalizeContext): RunEvent[] {
  const message = asObject(raw.message);
  const content = message?.content;
  if (Array.isArray(content)) {
    const events: RunEvent[] = [];
    for (const blockValue of content) {
      const block = asObject(blockValue);
      if (!block) continue;
      if (block.type === "tool_result") {
        const event: ToolResultEvent = {
          ...base("claude", context, raw),
          type: "tool_result",
          toolCallId: asString(block.tool_use_id),
          output: textFrom(block.content),
          status: block.is_error === true ? "failed" : "completed",
        };
        events.push(event);
      } else if (block.type === "text") {
        events.push({
          ...base("claude", context, raw),
          type: "text_delta",
          role: "user",
          text: asString(block.text) ?? "",
          delta: false,
        });
      }
    }
    if (events.length) return events;
  }
  const text = textFrom(content);
  if (text) {
    return [
      {
        ...base("claude", context, raw),
        type: "text_delta",
        role: "user",
        text,
        delta: false,
      },
    ];
  }
  return [
    {
      ...base("claude", context, raw),
      type: "unknown",
      sourceType: "user",
      data: raw,
    },
  ];
}

function claudeResultEvent(raw: JsonObject, context: NormalizeContext): RunEvent {
  const resultText = typeof raw.result === "string" ? raw.result : raw.result === undefined ? undefined : JSON.stringify(raw.result);
  const usage = usageFrom(raw.usage);
  if (raw.is_error === true) {
    const event: RunFailedEvent = {
      ...base("claude", context, raw),
      type: "run_failed",
      result: resultText,
      exitCode: asNullableNumber(raw.exit_code),
      error: errorFor(
        "claude",
        "provider_result_error",
        resultMessage(raw.result, asString(raw.subtype) ?? "Claude reported an error"),
        context,
      ),
    };
    return event;
  }
  const event: RunCompletedEvent = {
    ...base("claude", context, raw),
    type: "run_completed",
    result: resultText,
    usage,
    exitCode: asNullableNumber(raw.exit_code),
    numTurns: asNumber(raw.num_turns),
  };
  return event;
}

export function normalizeClaudeEvent(raw: unknown, context: NormalizeContext = {}): RunEvent[] {
  if (!isObject(raw) || typeof raw.type !== "string") {
    return [malformed("claude", context.rawLine ?? JSON.stringify(raw), "Claude event must be an object with a type", context)];
  }
  switch (raw.type) {
    case "system": {
      if (raw.subtype === "init") {
        return [
          {
            ...base("claude", context, raw),
            type: "run_started",
            runId: asString(raw.session_id),
            sessionId: asString(raw.session_id),
            metadata: {
              ...(asString(raw.model) ? { model: raw.model } : {}),
              ...(asString(raw.cwd) ? { cwd: raw.cwd } : {}),
              ...(asString(raw.permissionMode) ? { permissionMode: raw.permissionMode } : {}),
            },
          },
        ];
      }
      return [
        {
          ...base("claude", context, raw),
          type: "provider_status",
          status: "ready" as ProviderStatus,
          message: asString(raw.subtype),
        },
      ];
    }
    case "assistant":
      return claudeMessageEvent(raw, context);
    case "user":
      return claudeUserEvent(raw, context);
    case "result":
      return [claudeResultEvent(raw, context)];
    case "bridge_done":
      return [
        {
          ...base("claude", context, raw),
          type: "stream_ended",
          exitCode: asNullableNumber(raw.exit_code),
        },
      ];
    case "bridge_error":
      return [
        {
          ...base("claude", context, raw),
          type: "run_failed",
          error: errorFor("claude", "bridge_error", asString(raw.error) ?? "Claude bridge reported an error", context),
        },
      ];
    default:
      return [
        {
          ...base("claude", context, raw),
          type: "unknown",
          sourceType: raw.type,
          data: raw,
        },
      ];
  }
}

function codexItemEvent(raw: JsonObject, context: NormalizeContext): RunEvent[] {
  const item = asObject(raw.item);
  if (!item || typeof item.type !== "string") {
    return [malformed("codex", context.rawLine ?? JSON.stringify(raw), "Codex item event has no typed item", context)];
  }
  const itemType = item.type;
  const phase = asString(raw.type)?.split(".").at(-1);
  const itemId = asString(item.id);
  if (itemType === "agent_message") {
    return [
      {
        ...base("codex", context, raw),
        type: "text_delta",
        role: "assistant",
        text: asString(item.text) ?? "",
        itemId,
        delta: phase === "updated",
        final: phase === "completed",
      },
    ];
  }
  if (itemType === "reasoning") {
    return [
      {
        ...base("codex", context, raw),
        type: "reasoning_delta",
        text: asString(item.text) ?? "",
        itemId,
        delta: phase === "updated",
        final: phase === "completed",
      },
    ];
  }
  if (itemType === "command_execution") {
    if (phase === "completed") {
      const event: ToolResultEvent = {
        ...base("codex", context, raw),
        type: "tool_result",
        toolCallId: itemId,
        output: asString(item.aggregated_output) ?? asString(item.output) ?? "",
        exitCode: asNullableNumber(item.exit_code),
        status: asString(item.status),
      };
      return [event];
    }
    const event: ToolCallEvent = {
      ...base("codex", context, raw),
      type: "tool_call",
      toolCallId: itemId,
      name: "command_execution",
      command: asString(item.command),
      status: asString(item.status) ?? phase,
    };
    return [event];
  }
  if (itemType === "tool_call") {
    return [
      {
        ...base("codex", context, raw),
        type: "tool_call",
        toolCallId: itemId,
        name: asString(item.name),
        input: item.input ?? item.arguments,
        status: asString(item.status) ?? phase,
      },
    ];
  }
  if (itemType === "tool_result") {
    return [
      {
        ...base("codex", context, raw),
        type: "tool_result",
        toolCallId: asString(item.tool_call_id) ?? itemId,
        output: textFrom(item.output ?? item.content),
        exitCode: asNullableNumber(item.exit_code),
        status: asString(item.status) ?? phase,
      },
    ];
  }
  return [
    {
      ...base("codex", context, raw),
      type: "unknown",
      sourceType: `item.${itemType}`,
      data: item,
    },
  ];
}

export function normalizeCodexEvent(raw: unknown, context: NormalizeContext = {}): RunEvent[] {
  if (!isObject(raw) || typeof raw.type !== "string") {
    return [malformed("codex", context.rawLine ?? JSON.stringify(raw), "Codex event must be an object with a type", context)];
  }
  switch (raw.type) {
    case "thread.started":
      return [
        {
          ...base("codex", context, raw),
          type: "run_started",
          runId: asString(raw.thread_id),
          sessionId: asString(raw.thread_id),
        },
      ];
    case "turn.started":
      return [
        {
          ...base("codex", context, raw),
          type: "turn_started",
          turnId: asString(raw.turn_id),
        },
      ];
    case "item.started":
    case "item.updated":
    case "item.completed":
      return codexItemEvent(raw, context);
    case "turn.completed":
      return [
        {
          ...base("codex", context, raw),
          type: "run_completed",
          usage: usageFrom(raw.usage),
        },
      ];
    case "turn.failed":
    case "error": {
      const error = asObject(raw.error);
      return [
        {
          ...base("codex", context, raw),
          type: "run_failed",
          error: errorFor(
            "codex",
            raw.type === "error" ? "provider_error" : "turn_failed",
            resultMessage(error ?? raw, "Codex reported an error"),
            context,
          ),
        },
      ];
    }
    default:
      return [
        {
          ...base("codex", context, raw),
          type: "unknown",
          sourceType: raw.type,
          data: raw,
        },
      ];
  }
}

function inputLines(input: string | Iterable<string>): string[] {
  if (typeof input === "string") return input.split(/\r?\n/);
  return Array.from(input);
}

export function parseProviderJsonl(provider: ExecutionProvider, input: string | Iterable<string>): ParsedRunStream {
  const lines = inputLines(input);
  const events: RunEvent[] = [];
  const issues: ParseIssue[] = [];
  const normalize = provider === "claude" ? normalizeClaudeEvent : normalizeCodexEvent;
  lines.forEach((line, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Invalid JSON";
      issues.push({ provider, line: lineNumber, code: "invalid_json", message, rawLine: line });
      events.push(
        malformed(provider, line, message, { line: lineNumber, sequence: events.length, rawLine: line }, "invalid_json"),
      );
      return;
    }
    const normalized = normalize(raw, { line: lineNumber, sequence: events.length, rawLine: line });
    for (const event of normalized) events.push({ ...event, sequence: events.length });
    for (const event of normalized) {
      if (event.type === "malformed") {
        issues.push({
          provider,
          line: lineNumber,
          code: "invalid_event",
          message: event.error.message,
          rawLine: line,
        });
      }
    }
  });
  const terminal = events.some((event) => event.type === "run_completed" || event.type === "run_failed");
  return { provider, events, issues, lineCount: lines.length, terminal };
}

export function parseClaudeJsonl(input: string | Iterable<string>): ParsedRunStream {
  return parseProviderJsonl("claude", input);
}

export function parseCodexJsonl(input: string | Iterable<string>): ParsedRunStream {
  return parseProviderJsonl("codex", input);
}

/** Stream aliases make the parser names natural for adapters that already call input a stream. */
export const parseClaudeStream = parseClaudeJsonl;
export const parseCodexStream = parseCodexJsonl;

