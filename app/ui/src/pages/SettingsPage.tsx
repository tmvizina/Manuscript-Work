import { useEffect, useState } from "react";
import type { BookWriterTransport, ProjectSettingKey } from "../transport";

interface SettingsForm {
  preferredProvider: "claude" | "codex";
  defaultModel: string;
  permissionMode: "default" | "acceptEdits" | "plan";
  runVariant: "base" | "rag";
}

const DEFAULTS: SettingsForm = {
  preferredProvider: "claude",
  defaultModel: "",
  permissionMode: "default",
  runVariant: "base",
};

const KEYS = Object.keys(DEFAULTS) as ProjectSettingKey[];

export default function SettingsPage({ transport, projectId }: { transport: BookWriterTransport; projectId?: string }) {
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const [saved, setSaved] = useState<SettingsForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setMessage("");
    if (!projectId) {
      setLoading(false);
      return () => { alive = false; };
    }
    Promise.all(KEYS.map((key) => transport.settings.get(projectId, key)))
      .then((records) => {
        if (!alive) return;
        const next = { ...DEFAULTS };
        for (const record of records) {
          if (!record || typeof record.value !== "string") continue;
          if (record.key === "preferredProvider" && (record.value === "claude" || record.value === "codex")) next.preferredProvider = record.value;
          else if (record.key === "permissionMode" && (record.value === "default" || record.value === "acceptEdits" || record.value === "plan")) next.permissionMode = record.value;
          else if (record.key === "runVariant" && (record.value === "base" || record.value === "rag")) next.runVariant = record.value;
          else if (record.key === "defaultModel") next.defaultModel = record.value;
        }
        setForm(next);
        setSaved(next);
      })
      .catch((reason) => alive && setError(String(reason?.message ?? reason)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [projectId, transport]);

  const save = async () => {
    if (!projectId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const changed = KEYS.filter((key) => form[key] !== saved[key] && !(key === "defaultModel" && form.defaultModel.trim() === ""));
      await Promise.all(changed.map((key) => transport.settings.set(projectId, key, form[key])));
      setSaved(form);
      setMessage(changed.length === 0 ? "No setting changes to save." : "Project settings saved.");
    } catch (reason: any) {
      setError(String(reason?.message ?? reason));
    } finally {
      setSaving(false);
    }
  };

  if (!projectId) return <><h1>Project settings</h1><p className="hint">Select or import a project first.</p></>;
  if (loading) return <><h1>Project settings</h1><p className="hint">Loading settings...</p></>;

  return (
    <>
      <h1>Project settings</h1>
      <div className="card settings-form">
        <label>Preferred provider<select value={form.preferredProvider} onChange={(event) => setForm({ ...form, preferredProvider: event.target.value as SettingsForm["preferredProvider"] })}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
        <label>Default model<input type="text" value={form.defaultModel} placeholder="Use provider default" onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} /></label>
        <label>Permission mode<select value={form.permissionMode} onChange={(event) => setForm({ ...form, permissionMode: event.target.value as SettingsForm["permissionMode"] })}><option value="default">Default</option><option value="acceptEdits">Accept edits</option><option value="plan">Plan</option></select></label>
        <label>Default workflow variant<select value={form.runVariant} onChange={(event) => setForm({ ...form, runVariant: event.target.value as SettingsForm["runVariant"] })}><option value="base">Base</option><option value="rag">RAG-aware</option></select></label>
        <p className="hint">These values belong to this project. Provider execution remains disabled until the Phase 4 runner is enabled.</p>
        {error && <p className="err">{error}</p>}
        {message && <p>{message}</p>}
        <div><button className="btn" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save settings"}</button></div>
      </div>
    </>
  );
}
