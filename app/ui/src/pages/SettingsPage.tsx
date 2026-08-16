import { useEffect, useState } from "react";
import type { BookWriterTransport, ExecutionProvider, ProjectSettingKey, ProviderSummary } from "../transport";

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
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [authenticating, setAuthenticating] = useState<ExecutionProvider | null>(null);

  const scanProviders = () => {
    setProviders(null);
    transport.providers.status().then(setProviders).catch((reason) => setError(String(reason?.message ?? reason)));
  };

  useEffect(scanProviders, [transport]);

  const authenticate = async (provider: ExecutionProvider) => {
    setAuthenticating(provider); setError(""); setMessage("");
    try {
      const result = await transport.providers.auth(provider);
      const status = await transport.providers.status(provider);
      setProviders((current) => current?.map((item) => item.provider === provider ? (status[0] ?? item) : item) ?? status);
      setMessage(result.authenticated ? "Provider sign-in verified." : (result.message ?? "Provider sign-in was not verified."));
    } catch (reason: any) {
      setError(String(reason?.message ?? reason));
    } finally {
      setAuthenticating(null);
    }
  };

  const cancelAuthentication = async (provider: ExecutionProvider) => {
    try { await transport.providers.cancelAuth(provider); setMessage("Provider sign-in cancellation requested."); }
    catch (reason: any) { setError(String(reason?.message ?? reason)); }
  };

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
      <section className="provider-grid">
        {(providers ?? (["claude", "codex"] as const).map<ProviderSummary>((provider) => ({ provider, status: "checking" }))).map((provider) => <div className="card provider-card" key={provider.provider}><div className="row"><strong>{provider.provider === "claude" ? "Claude CLI" : "Codex CLI"}</strong><span className={`chip ${provider.status}`}>{provider.status.replace("_", " ")}</span></div>{provider.version && <p><code>{provider.version}</code></p>}{provider.executablePath && <p className="hint provider-path">{provider.executablePath}</p>}<p className="hint">{provider.message ?? "Checking this computer..."}</p>{(provider.status === "auth_required" || provider.status === "ready") && (authenticating === provider.provider ? <button className="btn" onClick={() => cancelAuthentication(provider.provider)}>Cancel sign-in</button> : <button className="btn" disabled={authenticating !== null} onClick={() => authenticate(provider.provider)}>{provider.status === "ready" ? "Re-authenticate" : "Sign in"}</button>)}</div>)}
      </section>
      <p><button className="btn ghost" onClick={scanProviders} disabled={providers === null}>Rescan providers</button></p>
      <div className="card settings-form">
        <label>Preferred provider<select value={form.preferredProvider} onChange={(event) => setForm({ ...form, preferredProvider: event.target.value as SettingsForm["preferredProvider"] })}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
        <label>Default model<input type="text" value={form.defaultModel} placeholder="Use provider default" onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} /></label>
        <label>Permission mode<select value={form.permissionMode} onChange={(event) => setForm({ ...form, permissionMode: event.target.value as SettingsForm["permissionMode"] })}><option value="default">Default</option><option value="acceptEdits">Accept edits</option><option value="plan">Plan</option></select></label>
        <label>Default workflow variant<select value={form.runVariant} onChange={(event) => setForm({ ...form, runVariant: event.target.value as SettingsForm["runVariant"] })}><option value="base">Base</option><option value="rag">RAG-aware</option></select></label>
        <p className="hint">These values belong to this project. Detection and interactive authentication are active; embedded installation and real execution remain disabled until their verified Phase 4 slices land.</p>
        {error && <p className="err">{error}</p>}
        {message && <p>{message}</p>}
        <div><button className="btn" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save settings"}</button></div>
      </div>
    </>
  );
}
