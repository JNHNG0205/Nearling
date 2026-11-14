"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { AppFrame, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import { addMcp, listMcp, McpRequestError, refreshMcp, removeMcp, type McpServerView } from "@/lib/mcp";
import { MCP_CATALOG } from "@/lib/mcpCatalog";
import { authHeaders, useSession } from "@/lib/session";

// /mcp: pick tools for your pet from a ready-made list (one click each); adding your own MCP server
// is optional. Then ask in chat: the pet proposes a tool call and nothing runs until you approve it.

export default function McpPage() {
  const session = useSession();
  return (
    <AppFrame title="MCP tools" wide>
      <p className="text-muted">
        Give your pet tools so it can do things for you. Connect one below, then ask in chat. Your pet suggests the
        tool it wants to use, and <strong className="text-ink">nothing runs until you press Approve</strong>.
      </p>
      {session ? <Tools /> : (
        <Panel>
          <p>Connect your wallet to choose your pet&apos;s tools.</p>
          <div className="self-start"><ConnectButton /></div>
        </Panel>
      )}
    </AppFrame>
  );
}

function Tools() {
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setServers(await listMcp(authHeaders()));
    } catch (err) {
      setError(err instanceof McpRequestError ? err.message : "Couldn't load your tools.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
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

  if (!servers) return error ? <ErrorText>{error}</ErrorText> : <Spinner label="Loading your tools..." />;

  // the brain stores addresses normalised (`new URL().toString()`), so compare them the same way
  const norm = (u: string) => { try { return new URL(u).toString(); } catch { return u; } };
  const byUrl = new Map(servers.map((s) => [norm(s.url), s]));
  const custom = servers.filter((s) => !MCP_CATALOG.some((c) => norm(c.url) === norm(s.url)));

  return (
    <div className="flex flex-col gap-6">
      <ErrorText>{error}</ErrorText>

      <section aria-label="Tools" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MCP_CATALOG.map((c) => {
          const on = byUrl.get(norm(c.url));
          return (
            <article key={c.id} className={`pixel-panel flex flex-col gap-2 p-4 ${on ? "border-accent" : ""}`}>
              <header className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg">{c.name}</h2>
                {on && <span className="font-display text-xs text-fuel">Connected</span>}
              </header>
              <p className="text-sm text-muted">{c.what}</p>
              {on ? (
                <>
                  <p className="text-xs text-muted">{on.tools.length} tools . Try: <span className="text-ink">&quot;{c.try}&quot;</span></p>
                  <button className="pixel-btn pixel-btn--secondary mt-auto self-start px-3 text-sm" disabled={busy !== null}
                    onClick={() => void run(c.id, () => removeMcp(authHeaders(), on.id))}>
                    {busy === c.id ? "..." : "Disconnect"}
                  </button>
                </>
              ) : (
                <button className="pixel-btn mt-auto self-start px-3 text-sm" disabled={busy !== null}
                  onClick={() => void run(c.id, () => addMcp(authHeaders(), { name: c.name, url: c.url }))}>
                  {busy === c.id ? "Connecting..." : "Connect"}
                </button>
              )}
            </article>
          );
        })}
      </section>

      {custom.length > 0 && (
        <section aria-label="Your own servers" className="flex flex-col gap-3">
          <h2 className="font-display text-lg">Your own servers</h2>
          {custom.map((s) => (
            <Panel key={s.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-display">{s.name}</span>
                  <span className="truncate font-mono text-xs text-muted" title={s.url}>{s.url}</span>
                  <span className="text-xs text-muted">{s.tools.length} tools{s.has_token ? " . uses a saved token" : ""}</span>
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
            </Panel>
          ))}
        </section>
      )}

      <CustomServer busy={busy} run={run} />

      <p className="text-xs text-muted">
        Petto&apos;s brain connects to these tools for you. What you ask a tool to do is sent to that tool&apos;s server,
        so do not share private information with it.
      </p>
    </div>
  );
}

/** Optional: any public Streamable HTTP MCP server, folded away by default. */
function CustomServer({ busy, run }: { busy: string | null; run: (label: string, fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [form, setForm] = useState({ name: "", url: "", token: "" });
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run("custom", () =>
      addMcp(authHeaders(), { name: form.name.trim(), url: form.url.trim(), ...(form.token.trim() ? { token: form.token.trim() } : {}) }),
    );
    if (ok) setForm({ name: "", url: "", token: "" });
  }
  return (
    <details className="pixel-panel p-4">
      <summary className="cursor-pointer font-display">Add your own server (optional)</summary>
      {/* autoComplete off and non-login field names: browsers must not fill an email and password here */}
      <form className="mt-3 flex max-w-xl flex-col gap-3" autoComplete="off" onSubmit={(e) => void add(e)}>
        <label className="flex flex-col gap-1">
          <span className="font-display text-sm">Name</span>
          <input name="mcp-server-name" autoComplete="off" className="border-2 border-line bg-bg px-3 py-2" maxLength={40} required
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My tool" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-display text-sm">Server address (Streamable HTTP, https)</span>
          <input name="mcp-server-url" autoComplete="off" inputMode="url" className="border-2 border-line bg-bg px-3 py-2 font-mono text-sm" required
            value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/mcp" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-display text-sm">Access token (only if the server needs one)</span>
          <input name="mcp-server-token" type="password" autoComplete="new-password" className="border-2 border-line bg-bg px-3 py-2 font-mono text-sm"
            value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
        </label>
        <button className="pixel-btn self-start" disabled={busy !== null}>{busy === "custom" ? "Connecting..." : "Connect"}</button>
      </form>
    </details>
  );
}
