"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { AppFrame, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import { addMcp, listMcp, McpRequestError, refreshMcp, removeMcp, type McpServerView } from "@/lib/mcp";
import { authHeaders, useSession } from "@/lib/session";

// /mcp: connect MCP servers (tools). Then ask your pet in chat; it proposes a tool call and nothing
// runs until you press Approve. The brain stores the address and token; tokens are never shown again.

const EXAMPLES = [
  { name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", note: "Ask questions about any public GitHub repo. No token needed." },
];

export default function McpPage() {
  const session = useSession();
  return (
    <AppFrame title="MCP tools" wide>
      <p className="text-muted">
        Connect tools so your pet can do things for you. Ask in chat, for example &quot;What does the near-api-js repo do?&quot;.
        Your pet suggests the tool it wants to use, and <strong className="text-ink">nothing runs until you press Approve</strong>.
      </p>
      {session ? <Servers /> : (
        <Panel>
          <p>Connect your wallet to manage your pet&apos;s tools.</p>
          <div className="self-start"><ConnectButton /></div>
        </Panel>
      )}
    </AppFrame>
  );
}

function Servers() {
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", url: "", token: "" });

  const load = useCallback(async () => {
    try {
      setServers(await listMcp(authHeaders()));
    } catch (err) {
      setError(err instanceof McpRequestError ? err.message : "Couldn't load your tools.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof McpRequestError ? err.message : "Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run("add", () => addMcp(authHeaders(), { name: form.name.trim(), url: form.url.trim(), ...(form.token.trim() ? { token: form.token.trim() } : {}) }));
    if (ok) setForm({ name: "", url: "", token: "" });
  }

  if (!servers) return error ? <ErrorText>{error}</ErrorText> : <Spinner label="Loading your tools..." />;

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
      <section aria-label="Connected tools" className="flex flex-col gap-3">
        <h2 className="font-display text-lg">Connected ({servers.length}/5)</h2>
        {servers.length === 0 && <p className="text-sm text-muted">No tools yet. Add one on the {"right"}, or try DeepWiki.</p>}
        {servers.map((s) => (
          <Panel key={s.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-display">{s.name}</span>
                <span className="truncate font-mono text-xs text-muted" title={s.url}>{s.url}</span>
                {s.has_token && <span className="text-xs text-muted">Uses a saved token</span>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="pixel-btn pixel-btn--secondary px-3 text-sm" disabled={busy !== null} onClick={() => void run(`r${s.id}`, () => refreshMcp(authHeaders(), s.id))}>
                  {busy === `r${s.id}` ? "..." : "Refresh"}
                </button>
                <button className="pixel-btn pixel-btn--secondary px-3 text-sm" disabled={busy !== null} onClick={() => void run(`d${s.id}`, () => removeMcp(authHeaders(), s.id))}>
                  {busy === `d${s.id}` ? "..." : "Remove"}
                </button>
              </div>
            </div>
            <ul className="flex flex-col gap-1 border-t-2 border-line pt-2">
              {s.tools.map((t) => (
                <li key={t.name} className="text-sm">
                  <span className="font-mono text-accent">{t.name}</span>
                  {t.description && <span className="text-muted"> . {t.description.slice(0, 120)}</span>}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </section>

      <section aria-label="Add a tool" className="flex flex-col gap-3">
        <h2 className="font-display text-lg">Add an MCP server</h2>
        <Panel>
          <form className="flex flex-col gap-3" onSubmit={(e) => void add(e)}>
            <label className="flex flex-col gap-1">
              <span className="font-display text-sm">Name</span>
              <input className="border-2 border-line bg-bg px-3 py-2" maxLength={40} required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Calendar" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-display text-sm">Server address (Streamable HTTP)</span>
              <input className="border-2 border-line bg-bg px-3 py-2 font-mono text-sm" type="url" required value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/mcp" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-display text-sm">Access token (optional)</span>
              <input className="border-2 border-line bg-bg px-3 py-2 font-mono text-sm" type="password" autoComplete="off" value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="Only if the server asks for one" />
            </label>
            <button className="pixel-btn self-start" disabled={busy !== null}>{busy === "add" ? "Connecting..." : "Connect"}</button>
          </form>
        </Panel>
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-sm">Try one</h3>
          {EXAMPLES.map((ex) => (
            <button key={ex.url} className="pixel-panel flex flex-col items-start gap-1 p-3 text-left hover:border-accent"
              disabled={busy !== null || servers.some((s) => s.url === ex.url)}
              onClick={() => void run("add", () => addMcp(authHeaders(), { name: ex.name, url: ex.url }))}>
              <span className="font-display text-accent">{servers.some((s) => s.url === ex.url) ? `${ex.name} (connected)` : `Connect ${ex.name}`}</span>
              <span className="text-sm text-muted">{ex.note}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          Only public https servers. Petto&apos;s brain connects for you, keeps any token encrypted and never shows it again.
          What you ask a tool to do goes to that tool&apos;s server.
        </p>
      </section>
    </div>
  );
}
