"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { AppFrame, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import {
  addMcp, connectTool, getCatalog, listMcp, McpRequestError, refreshMcp, removeMcp,
  type CatalogTool, type McpServerView,
} from "@/lib/mcp";
import { authHeaders, useSession } from "@/lib/session";

// /mcp: connect tools for your pet. Apps (Gmail, Calendar, Slack, Notion, Canva) send you to their own
// sign-in page and back; Firecrawl takes your API key; open knowledge tools connect in one click.
// Then ask in chat: the pet proposes a tool call and nothing runs until you press Approve.

const APPS = ["gmail", "gcal", "slack", "notion", "canva", "firecrawl", "playwright"];

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
  const [catalog, setCatalog] = useState<CatalogTool[] | null>(null);
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([getCatalog(), listMcp(authHeaders())]);
      setCatalog(c);
      setServers(s);
    } catch (err) {
      setError(err instanceof McpRequestError ? err.message : "Couldn't load your tools.");
    }
  }, []);

  useEffect(() => {
    // back from a provider's sign-in page: say how it went, then tidy the address bar
    const q = new URLSearchParams(window.location.search);
    if (q.get("connected")) setNotice("Connected! Ask your pet to use it in chat.");
    if (q.get("mcp_error")) setError(q.get("mcp_error"));
    if (q.size) window.history.replaceState(null, "", "/mcp");
    void load();
  }, [load]);

  async function run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(label);
    setError(null);
    setNotice(null);
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

  async function connect(tool: CatalogTool, key?: string) {
    setBusy(tool.id);
    setError(null);
    setNotice(null);
    try {
      const r = await connectTool(authHeaders(), tool.id, key);
      if (r.authorize_url) {
        window.location.href = r.authorize_url; // the provider's own sign-in page; it sends you back here
        return true;
      }
      await load();
      setNotice(`${tool.name} connected! Ask your pet to use it in chat.`);
      return true;
    } catch (err) {
      setError(err instanceof McpRequestError ? err.message : "Couldn't connect. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!catalog || !servers) return error ? <ErrorText>{error}</ErrorText> : <Spinner label="Loading your tools..." />;

  const byTool = new Map(servers.filter((s) => s.catalog_id).map((s) => [s.catalog_id!, s]));
  const custom = servers.filter((s) => !s.catalog_id);
  const card = (t: CatalogTool) => (
    <ToolCard key={t.id} tool={t} on={byTool.get(t.id)} busy={busy}
      onConnect={(key) => connect(t, key)}
      onDisconnect={(id) => void run(t.id, () => removeMcp(authHeaders(), id))}
      onRefresh={(id) => void run(t.id, () => refreshMcp(authHeaders(), id))} />
  );

  return (
    <div className="flex flex-col gap-6">
      {notice && <p className="border-2 border-fuel px-3 py-2 text-sm text-fuel" role="status">{notice}</p>}
      <ErrorText>{error}</ErrorText>

      <section aria-label="Apps" className="flex flex-col gap-3">
        <h2 className="font-display text-lg">Your apps</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{catalog.filter((t) => APPS.includes(t.id)).map(card)}</div>
      </section>

      <section aria-label="Knowledge" className="flex flex-col gap-3">
        <h2 className="font-display text-lg">Knowledge (no account needed)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{catalog.filter((t) => !APPS.includes(t.id)).map(card)}</div>
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
        Petto&apos;s brain connects to these tools for you and keeps sign-ins and keys encrypted. What you ask a tool to do
        is sent to that tool&apos;s service.
      </p>
    </div>
  );
}

function ToolCard({ tool, on, busy, onConnect, onDisconnect, onRefresh }: {
  tool: CatalogTool;
  on: McpServerView | undefined;
  busy: string | null;
  onConnect: (key?: string) => Promise<boolean>;
  onDisconnect: (serverId: number) => void;
  onRefresh: (serverId: number) => void;
}) {
  const [askKey, setAskKey] = useState(false);
  const [key, setKey] = useState("");
  const mine = busy === tool.id;
  return (
    <article className={`pixel-panel flex flex-col gap-2 p-4 ${on ? "border-accent" : ""}`}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg">{tool.name}</h3>
        {on ? <span className="font-display text-xs text-fuel">Connected</span>
          : tool.auth === "local" ? <span className="font-display text-xs text-muted">On your computer</span>
          : tool.auth === "oauth" && !tool.available ? <span className="font-display text-xs text-muted">Coming soon</span>
          : null}
      </header>
      <p className="text-sm text-muted">{tool.what}</p>
      {tool.via && !on && (
        <p className="text-xs text-muted">Connects through {tool.via} (free account): sign in there and allow your {tool.name}.</p>
      )}

      {on ? (
        <>
          {on.tools.length === 0 ? (
            <p className="border-2 border-warn px-2 py-1 text-xs text-warn" role="status">
              Connected, but no {tool.name} actions are turned on, so your pet can't use it yet.
              {tool.via === "Zapier" ? <> Turn on {tool.name} actions at <a className="underline" href="https://mcp.zapier.com" target="_blank" rel="noreferrer">mcp.zapier.com</a>, then press Refresh.</> : " Press Refresh to check again."}
            </p>
          ) : (
            <p className="text-xs text-muted">{on.tools.length} actions . Try: <span className="text-ink">&quot;{tool.try}&quot;</span></p>
          )}
          <div className="mt-auto flex gap-2">
            <button className="pixel-btn pixel-btn--secondary px-3 text-sm" disabled={busy !== null} onClick={() => onRefresh(on.id)}>Refresh</button>
            <button className="pixel-btn pixel-btn--secondary px-3 text-sm" disabled={busy !== null} onClick={() => onDisconnect(on.id)}>
              {mine ? "..." : "Disconnect"}
            </button>
          </div>
        </>
      ) : tool.auth === "local" ? (
        <p className="mt-auto text-xs text-muted">{tool.help}</p>
      ) : tool.auth === "oauth" && !tool.available ? (
        <p className="mt-auto text-xs text-muted">Sign-in for {tool.name} is not set up on this Petto yet.</p>
      ) : tool.auth === "key" && askKey ? (
        <form className="mt-auto flex flex-col gap-2" autoComplete="off"
          onSubmit={(e) => { e.preventDefault(); void onConnect(key.trim()).then((ok) => ok && setKey("")); }}>
          <input name={`${tool.id}-api-key`} type="password" autoComplete="new-password" required value={key} onChange={(e) => setKey(e.target.value)}
            className="border-2 border-line bg-bg px-3 py-2 font-mono text-sm" placeholder={tool.key_name} />
          <span className="text-xs text-muted">
            Get one at <a className="text-accent underline" href={tool.key_url} target="_blank" rel="noreferrer">{tool.key_url?.replace(/^https:\/\//, "")}</a>
          </span>
          <button className="pixel-btn self-start px-3 text-sm" disabled={busy !== null}>{mine ? "Connecting..." : "Connect"}</button>
        </form>
      ) : (
        <button className="pixel-btn mt-auto self-start px-3 text-sm" disabled={busy !== null}
          onClick={() => (tool.auth === "key" ? setAskKey(true) : void onConnect())}>
          {mine ? (tool.auth === "oauth" ? "Opening sign-in..." : "Connecting...") : tool.auth === "oauth" ? `Sign in with ${tool.via ?? tool.name.split(" ")[0]}` : "Connect"}
        </button>
      )}
    </article>
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
