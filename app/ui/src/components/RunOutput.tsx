import { useEffect, useRef, useState } from "react";
import { streamRun } from "../lib/api";

interface Line {
  kind: "text" | "tool" | "info" | "error";
  text: string;
}

function describeEvent(o: any): Line | null {
  if (o.type === "system" && o.subtype === "init") return { kind: "info", text: `session started (${o.model ?? "claude"})` };
  if (o.type === "assistant") {
    const parts: Line[] = [];
    for (const block of o.message?.content ?? []) {
      if (block.type === "text" && block.text?.trim()) parts.push({ kind: "text", text: block.text });
      if (block.type === "tool_use") {
        const arg =
          block.input?.file_path ?? block.input?.command?.slice?.(0, 80) ?? block.input?.pattern ?? block.input?.skill ?? "";
        parts.push({ kind: "tool", text: `⚒ ${block.name}${arg ? `: ${arg}` : ""}` });
      }
    }
    // Collapse to one entry per event for simplicity; join texts.
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    return { kind: "text", text: parts.map((p) => p.text).join("\n") };
  }
  if (o.type === "result") {
    return o.is_error
      ? { kind: "error", text: `error: ${o.result ?? o.subtype}` }
      : null; // final text already streamed as assistant message
  }
  if (o.type === "bridge_error") return { kind: "error", text: o.error };
  return null;
}

export default function RunOutput({
  runId,
  onFinished,
  onClose,
}: {
  runId: string;
  onFinished: () => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [running, setRunning] = useState(true);
  const [cancelState, setCancelState] = useState<"idle" | "busy" | "failed">("idle");
  const [elapsed, setElapsed] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true); // follow the stream only while the user is at the bottom

  const onScroll = () => {
    const el = boxRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    const stop = streamRun(
      runId,
      (o) => {
        const line = describeEvent(o);
        if (line) setLines((prev) => [...prev, line]);
        if (o.type === "result") setMeta(o);
      },
      () => {
        setRunning(false);
        clearInterval(tick);
        onFinished();
      },
    );
    return () => {
      stop();
      clearInterval(tick);
    };
  }, [runId]);

  useEffect(() => {
    if (pinnedRef.current) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [lines]);

  const cancel = async () => {
    setCancelState("busy");
    try {
      const res = await fetch(`/api/claude/runs/${runId}/cancel`, { method: "POST" });
      // 409 = run already finished; the stream's done event will close things out.
      if (!res.ok && res.status !== 409) throw new Error(`${res.status}`);
    } catch {
      setCancelState("failed");
      return;
    }
    setCancelState("idle");
  };

  return (
    <div className="output">
      <div className="stream" ref={boxRef} onScroll={onScroll}>
        {lines.length === 0 && <p className="hint">{running ? "Waiting for claude…" : "No output."}</p>}
        {lines.map((l, i) =>
          l.kind === "tool" ? (
            <div key={i} className="tool">
              {l.text}
            </div>
          ) : (
            <p key={i} className={`txt ${l.kind === "error" ? "err" : ""}`}>
              {l.text}
            </p>
          ),
        )}
      </div>
      <div className="meta">
        <span>{running ? `running… ${elapsed}s` : "finished"}</span>
        {meta && (
          <>
            <span>{meta.num_turns} turns</span>
            {meta.total_cost_usd != null && <span>${meta.total_cost_usd.toFixed(3)}</span>}
            {meta.usage && (
              <span>
                {meta.usage.input_tokens?.toLocaleString?.() ?? "?"} in / {meta.usage.output_tokens?.toLocaleString?.() ?? "?"} out tok
              </span>
            )}
          </>
        )}
        {running && (
          <button className="btn danger" onClick={cancel} disabled={cancelState === "busy"}>
            {cancelState === "busy" ? "Cancelling…" : "Cancel"}
          </button>
        )}
        {running && cancelState === "failed" && <span className="err">cancel failed — try again</span>}
        {!running && (
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
