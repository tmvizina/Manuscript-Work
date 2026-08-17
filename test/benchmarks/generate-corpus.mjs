#!/usr/bin/env node
/**
 * Generate deterministic, synthetic stress input without checking a giant
 * artifact into the repository.
 *
 * Examples:
 *   node test/benchmarks/generate-corpus.mjs --kind corpus --chars 10000000 --output "$TEMP/corpus.txt"
 *   node test/benchmarks/generate-corpus.mjs --kind transcript --provider claude --chars 10000000 --stdout > "$TEMP/run.jsonl"
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_CHARS = 10_000_000;
const MAX_EVENT_PAYLOAD = 8_192;
const CORPUS_SENTENCE =
  "Synthetic benchmark prose records a quiet observation, a measured response, and a clear stop.\n";
const TRANSCRIPT_SENTENCE =
  "Synthetic transcript payload: the parser should retain this observation while it streams. ";

function usage() {
  return `Usage: node test/benchmarks/generate-corpus.mjs [options]

Options:
  --kind <corpus|transcript>  Plain text corpus or valid provider JSONL (default: corpus)
  --provider <claude|codex>   Event shape for --kind transcript (default: codex)
  --chars <n>                 Target UTF-16 character count (default: 10000000)
  --output <path>             Write to this path; parent directories are created
  --stdout                    Stream generated content to stdout
  --help                      Show this help

Nothing is written when neither --output nor --stdout is supplied. This makes
the ten-million-character case safe to inspect in CI without creating an
untracked artifact. The command reports the actual character and byte counts
on stderr after generation.
`;
}

function parseArgs(argv) {
  const options = {
    kind: "corpus",
    provider: "codex",
    chars: DEFAULT_CHARS,
    output: null,
    stdout: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }
    if (arg === "--kind" || arg === "--provider" || arg === "--chars" || arg === "--output") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--kind") options.kind = value;
      if (arg === "--provider") options.provider = value;
      if (arg === "--output") options.output = value;
      if (arg === "--chars") {
        const normalized = value.replaceAll("_", "").replaceAll(",", "");
        if (!/^\d+$/.test(normalized)) throw new Error(`--chars must be a non-negative integer, got ${value}`);
        options.chars = Number(normalized);
        if (!Number.isSafeInteger(options.chars)) throw new Error(`--chars is too large: ${value}`);
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.help && !new Set(["corpus", "transcript"]).has(options.kind)) {
    throw new Error(`--kind must be corpus or transcript, got ${options.kind}`);
  }
  if (!options.help && !new Set(["claude", "codex"]).has(options.provider)) {
    throw new Error(`--provider must be claude or codex, got ${options.provider}`);
  }
  if (options.output && options.stdout) throw new Error("Use --output or --stdout, not both");
  return options;
}

function repeatToLength(seed, length) {
  if (length <= 0) return "";
  let result = "";
  while (result.length < length) result += seed;
  return result.slice(0, length);
}

function writeRepeated(fd, seed, length) {
  let remaining = length;
  while (remaining > 0) {
    const chunk = repeatToLength(seed, Math.min(remaining, MAX_EVENT_PAYLOAD));
    fs.writeSync(fd, chunk);
    remaining -= chunk.length;
  }
}

function claudeEvent(text, index) {
  return {
    type: "assistant",
    message: {
      id: `msg-benchmark-${index}`,
      type: "message",
      role: "assistant",
      model: "claude-synthetic-benchmark",
      content: [{ type: "text", text }],
    },
    parent_tool_use_id: null,
    session_id: "sess-benchmark-001",
  };
}

function codexEvent(text, index) {
  return {
    type: "item.updated",
    item: {
      id: `item-benchmark-${index}`,
      type: "agent_message",
      text,
    },
  };
}

function generateCorpus(fd, target) {
  writeRepeated(fd, CORPUS_SENTENCE, target);
}

function generateTranscript(fd, target, provider) {
  const header =
    provider === "claude"
      ? `${JSON.stringify({
          type: "system",
          subtype: "init",
          cwd: "/synthetic/benchmark",
          session_id: "sess-benchmark-001",
          model: "claude-synthetic-benchmark",
        })}\n`
      : `${JSON.stringify({ type: "thread.started", thread_id: "thread-benchmark-001" })}\n${JSON.stringify({ type: "turn.started" })}\n`;
  const trailer =
    provider === "claude"
      ? `${JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Synthetic benchmark completed.",
          num_turns: 1,
          usage: { input_tokens: 1, output_tokens: 1 },
        })}\n${JSON.stringify({ type: "bridge_done", exit_code: 0 })}\n`
      : `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })}\n`;
  const emptyEvent = `${JSON.stringify(provider === "claude" ? claudeEvent("", 0) : codexEvent("", 0))}\n`;
  const minimum = header.length + emptyEvent.length + trailer.length;
  const requested = Math.max(target, minimum);

  fs.writeSync(fd, header);
  let written = header.length;
  let index = 0;
  let remaining = requested - header.length - trailer.length;
  const eventFixedLength = emptyEvent.length;

  // Keep each write bounded. The final event is sized so that the resulting
  // JSONL stream reaches the requested character count exactly.
  while (remaining > eventFixedLength + MAX_EVENT_PAYLOAD) {
    const text = repeatToLength(TRANSCRIPT_SENTENCE, MAX_EVENT_PAYLOAD);
    const line = `${JSON.stringify(provider === "claude" ? claudeEvent(text, index) : codexEvent(text, index))}\n`;
    fs.writeSync(fd, line);
    written += line.length;
    remaining -= line.length;
    index += 1;
  }

  const finalPayloadLength = remaining - eventFixedLength;
  if (finalPayloadLength >= 0) {
    const text = repeatToLength(TRANSCRIPT_SENTENCE, finalPayloadLength);
    const line = `${JSON.stringify(provider === "claude" ? claudeEvent(text, index) : codexEvent(text, index))}\n`;
    fs.writeSync(fd, line);
    written += line.length;
  }
  fs.writeSync(fd, trailer);
  written += trailer.length;

  // The caller uses the file descriptor position for byte count. Returning
  // this value also keeps the function easy to exercise in a small benchmark.
  return written;
}

function destination(options) {
  if (options.stdout) return { fd: 1, close: false, label: "stdout" };
  if (!options.output) return null;
  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  return { fd: fs.openSync(outputPath, "w"), close: true, label: outputPath };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const out = destination(options);
  if (!out) {
    console.log(
      `No output selected. Would generate ${options.chars.toLocaleString("en-US")} characters as ${options.kind}` +
        (options.kind === "transcript" ? ` (${options.provider} JSONL)` : "") +
        ". Pass --output <path> or --stdout to write it.",
    );
    return;
  }

  const started = Date.now();
  let reportedCharacters = 0;
  try {
    if (options.kind === "corpus") {
      generateCorpus(out.fd, options.chars);
      reportedCharacters = options.chars;
    } else {
      reportedCharacters = generateTranscript(out.fd, options.chars, options.provider);
    }
  } finally {
    if (out.close) fs.closeSync(out.fd);
  }

  const outputBytes = out.label === "stdout" ? reportedCharacters : fs.statSync(out.label).size;
  console.error(
    JSON.stringify({
      kind: options.kind,
      provider: options.kind === "transcript" ? options.provider : null,
      requested_characters: options.chars,
      generated_characters: reportedCharacters,
      generated_bytes: outputBytes,
      destination: out.label,
      elapsed_ms: Date.now() - started,
    }),
  );
}

main();

