import { useEffect, useState } from "react";
import type { BookWriterTransport, ExecutionProvider, ProviderSummary } from "../transport";

const LABELS: Record<ExecutionProvider, string> = { claude: "Claude CLI", codex: "Codex CLI" };

export default function ProviderOnboardingPage({ transport, projectId }: { transport: BookWriterTransport; projectId?: string }) {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [selected, setSelected] = useState<ExecutionProvider | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [authenticating, setAuthenticating] = useState<ExecutionProvider | null>(null);

  const scan = () => {
    setProviders(null); setError("");
    transport.providers.status().then(setProviders).catch((reason) => setError(String(reason?.message ?? reason)));
  };

  useEffect(() => {
    scan();
    if (projectId) transport.settings.get(projectId, "preferredProvider").then((record) => {
      if (record?.value === "claude" || record?.value === "codex") setSelected(record.value);
    }).catch((reason) => setError(String(reason?.message ?? reason)));
  }, [projectId, transport]);

  const choose = async (provider: ExecutionProvider) => {
    if (!projectId) return;
    setError(""); setMessage("");
    try {
      await transport.settings.set(projectId, "preferredProvider", provider);
      setSelected(provider);
      setMessage(`${LABELS[provider]} selected for this project.`);
    } catch (reason: any) { setError(String(reason?.message ?? reason)); }
  };

  const authenticate = async (provider: ExecutionProvider) => {
    setAuthenticating(provider); setError(""); setMessage("");
    try {
      const result = await transport.providers.auth(provider);
      const statuses = await transport.providers.status(provider);
      setProviders((current) => current?.map((item) => item.provider === provider ? (statuses[0] ?? item) : item) ?? statuses);
      setMessage(result.authenticated ? `${LABELS[provider]} sign-in verified.` : (result.message ?? `${LABELS[provider]} sign-in was not verified.`));
    } catch (reason: any) {
      setError(String(reason?.message ?? reason));
    } finally {
      setAuthenticating(null);
    }
  };

  const cancelAuthentication = async (provider: ExecutionProvider) => {
    setError("");
    try {
      await transport.providers.cancelAuth(provider);
      setMessage(`${LABELS[provider]} sign-in cancellation requested.`);
    } catch (reason: any) {
      setError(String(reason?.message ?? reason));
    }
  };

  if (!projectId) return <><h1>Provider setup</h1><p className="hint">Import or select a project before choosing its provider.</p></>;

  return <>
    <h1>Provider setup</h1>
    <p className="sub">Book Writer detects CLIs locally. Authentication and hosted model use may still require internet access.</p>
    <div className="provider-grid">
      {(providers ?? (["claude", "codex"] as const).map<ProviderSummary>((provider) => ({ provider, status: "checking" }))).map((provider) => {
        const detected = provider.status === "ready" || provider.status === "auth_required";
        return <div className={`card provider-card ${selected === provider.provider ? "selected" : ""}`} key={provider.provider}>
          <div className="row"><strong>{LABELS[provider.provider]}</strong><span className={`chip ${provider.status}`}>{provider.status.replace("_", " ")}</span></div>
          {provider.version && <p><code>{provider.version}</code></p>}
          {provider.executablePath && <p className="hint provider-path">{provider.executablePath}</p>}
          <p className="hint">{provider.message ?? "Checking this computer..."}</p>
          {provider.status === "auth_required" && (authenticating === provider.provider
            ? <button className="btn" onClick={() => cancelAuthentication(provider.provider)}>Cancel sign-in</button>
            : <button className="btn" disabled={authenticating !== null} onClick={() => authenticate(provider.provider)}>{`Sign in to ${LABELS[provider.provider]}`}</button>)}
          {detected ? <button className="btn" onClick={() => choose(provider.provider)}>{selected === provider.provider ? "Selected" : `Use ${LABELS[provider.provider]}`}</button> : <button className="btn" disabled title="Embedded payload requires license, hash, and publisher approval before installation is enabled">Install {LABELS[provider.provider]} (pending payload approval)</button>}
        </div>;
      })}
    </div>
    <p><button className="btn ghost" onClick={scan} disabled={providers === null}>Rescan PATH</button></p>
    <div className="card provider-notice"><strong>Security boundary</strong><p>Sign-in opens the detected provider CLI in its own terminal; Book Writer does not receive passwords, tokens, or terminal output. Embedded installation stays disabled until a pinned payload manifest, redistribution approval, SHA-256, and publisher verification are checked in.</p></div>
    {message && <p>{message}</p>}{error && <p className="err">{error}</p>}
  </>;
}
