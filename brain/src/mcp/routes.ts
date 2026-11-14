import { Hono } from "hono";
import { z } from "zod";
import { requireCaller, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { jsonBody } from "../identity/common";
import { log } from "../log";
import { checkUrl, listTools, McpError, type McpTool } from "./client";
import { resolveServer, sealAuth, startSignIn, finishSignIn, type StoredAuth } from "./auth";
import { CATALOG, catalogEntry, catalogView, effectiveEntry, ZAPIER_MCP_URL, ZAPIER_TOOLS } from "./catalog";
import { server, servers, tokenContext, type ServerRow } from "./store";

/**
 * Web /mcp: the owner connects MCP servers (Streamable HTTP). The brain stores the URL, an optional
 * bearer token (sealed) and the tool list; the pet can then propose those tools in chat
 * (talk.ts, approve/decline routes). Tokens are never sent back.
 */

const MAX_SERVERS = 10;

const AddBody = z.object({
  name: z.string().trim().min(1).max(40),
  url: z.string().trim().min(8).max(300),
  token: z.string().trim().max(2_000).optional(),
});

const ERRORS: Record<McpError["code"], string> = {
  bad_url: "Use the server's full https address, e.g. https://example.com/mcp",
  private_address: "That address points at a private network. Petto only connects to public MCP servers.",
  unreachable: "Couldn't connect to that MCP server. Check the address (and token, if it needs one).",
  tool_failed: "The MCP server answered with an error.",
  not_set_up: "This tool is not set up on this Petto yet (the team needs to add its sign-in app).",
  expired: "That sign-in took too long or was already used. Press Connect again.",
  needs_key: "Paste your API key to connect this tool.",
};

const view = (s: ServerRow) => ({
  id: s.id,
  name: s.name,
  url: s.url,
  has_token: s.token_enc !== null,
  // servers added by address before the catalog existed still show on their catalog card
  catalog_id: s.catalog_id ?? CATALOG.find((e) => e.auth.kind === "none" && new URL(e.url).toString() === s.url)?.id ?? null,
  tools: (JSON.parse(s.tools_json) as McpTool[]).map((t) => ({ name: t.name, description: t.description })),
  refreshed_at: s.refreshed_at,
});

/** Through Zapier one sign-in reaches every app the user allowed there: a card only gets its own app's tools. */
function cardTools(catalogId: string, url: string, tools: McpTool[]): McpTool[] {
  const listed = catalogEntry(catalogId);
  if (url !== ZAPIER_MCP_URL || !listed?.viaZapier) return tools;
  // names only (public tool metadata, no user content): shows why a card ends up with 0 actions
  log.info("mcp zapier tools", { catalog_id: catalogId, count: tools.length, names: tools.map((x) => x.name).slice(0, 40).join(",") });
  // Zapier's connect server is generic: find an enabled action, then run it. Keep those, drop its admin tools.
  return tools.filter((x) => ZAPIER_TOOLS.has(x.name));
}

export function mcpRoutes(deps: Deps) {
  const { cfg, db, sealer, now } = deps;
  const app = new Hono<AuthEnv>();
  const owner = requireCaller(deps, ["owner"]);
  const fail = (err: unknown) => {
    const code = err instanceof McpError ? err.code : "unreachable";
    return { error: { code: "invalid", message: ERRORS[code] } };
  };

  /** Public list of ready-made tools and how each connects (no endpoints for key tools, no secrets). */
  app.get("/mcp/catalog", (c) => c.json({ tools: catalogView(cfg) }));

  /** Saves a connected catalog tool: one row per owner and tool (connecting again replaces it). */
  async function saveCatalogServer(account: string, id: string, auth: StoredAuth | null, viaZapierKey = false): Promise<ServerRow> {
    const listed = catalogEntry(id)!;
    const e = viaZapierKey ? { ...listed, url: ZAPIER_MCP_URL } : effectiveEntry(cfg, listed);
    const probe = { id: 0, owner_account: account, name: e.name, url: e.url, token_enc: auth ? sealAuth(deps, account, auth) : null, tools_json: "[]", catalog_id: e.id, created_at: 0, refreshed_at: 0 };
    const { url, token } = await resolveServer(deps, account, probe);
    const tools = cardTools(listed.id, e.url, await listTools(url, token));
    const t = now();
    db.prepare("DELETE FROM mcp_server WHERE owner_account = ? AND catalog_id = ?").run(account, e.id);
    const newId = db
      .prepare("INSERT INTO mcp_server (owner_account, name, url, token_enc, tools_json, catalog_id, created_at, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(account, e.name, e.url, probe.token_enc, JSON.stringify(tools), e.id, t, t).lastInsertRowid as number;
    log.info("mcp catalog tool connected", { server_id: newId, catalog_id: e.id, tools: tools.length });
    return server(deps, account, newId)!;
  }

  /**
   * Connect a catalog tool. Open tools connect at once; key tools need `key`; sign-in tools return
   * `authorize_url` for the browser to open (the provider sends it back to /mcp/oauth/callback).
   */
  app.post("/me/mcp/connect", owner, async (c) => {
    const account = c.get("caller").account;
    const body = z.object({ id: z.string().max(40), key: z.string().trim().max(400).optional() }).safeParse(await jsonBody(c));
    const e = body.success ? catalogEntry(body.data.id) : undefined;
    if (!body.success || !e || e.auth.kind === "local") return c.json({ error: { code: "invalid", message: "Unknown tool" } }, 400);
    if (servers(deps, account).filter((s) => s.catalog_id !== e.id).length >= MAX_SERVERS) {
      return c.json({ error: { code: "invalid", message: `Up to ${MAX_SERVERS} tools. Disconnect one first.` } }, 400);
    }
    try {
      // Gmail, Calendar, Slack: the user's own Zapier API key instead of signing in (stored sealed, for this user only)
      if (e.viaZapier && body.data.key) return c.json(view(await saveCatalogServer(account, e.id, { kind: "bearer", token: body.data.key }, true)), 201);
      if (e.auth.kind === "oauth") return c.json({ authorize_url: await startSignIn(deps, account, e) });
      if (e.auth.kind === "key" && !body.data.key) throw new McpError("needs_key");
      const s = await saveCatalogServer(account, e.id, e.auth.kind === "key" ? { kind: "path_key", key: body.data.key! } : null);
      return c.json(view(s), 201);
    } catch (err) {
      log.warn("mcp connect failed", { catalog_id: e.id, error: err instanceof McpError ? err.code : "unknown" });
      return c.json(fail(err), 400);
    }
  });

  /** The provider sends the browser here after sign-in; we finish and send it back to the web page. */
  app.get("/mcp/oauth/callback", async (c) => {
    const back = (q: string) => c.redirect(`${cfg.PUBLIC_WEB_URL.replace(/\/$/, "")}/mcp?${q}`);
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code");
    if (!code) {
      if (state) db.prepare("DELETE FROM mcp_oauth_state WHERE state = ?").run(state);
      return back(`mcp_error=${encodeURIComponent("Sign-in was cancelled.")}`);
    }
    try {
      const { owner: account, entry, auth } = await finishSignIn(deps, state, code);
      await saveCatalogServer(account, entry.id, auth);
      return back(`connected=${encodeURIComponent(entry.id)}`);
    } catch (err) {
      log.warn("mcp sign-in failed", { error: err instanceof McpError ? err.code : err instanceof Error ? err.name : "unknown" });
      return back(`mcp_error=${encodeURIComponent(fail(err).error.message)}`);
    }
  });

  app.get("/me/mcp", owner, (c) => c.json({ servers: servers(deps, c.get("caller").account).map(view) }));

  app.post("/me/mcp", owner, async (c) => {
    const account = c.get("caller").account;
    const body = AddBody.safeParse(await jsonBody(c));
    if (!body.success) return c.json({ error: { code: "invalid", message: "Send a name (up to 40 characters) and the server address" } }, 400);
    if (servers(deps, account).length >= MAX_SERVERS) {
      return c.json({ error: { code: "invalid", message: `Up to ${MAX_SERVERS} MCP servers. Remove one first.` } }, 400);
    }
    const token = body.data.token || null;
    let tools: McpTool[];
    let url: URL;
    try {
      url = await checkUrl(body.data.url, cfg.MCP_ALLOW_PRIVATE);
      tools = await listTools(url, token);
    } catch (err) {
      log.warn("mcp connect failed", { error: err instanceof McpError ? err.code : "unknown" });
      return c.json(fail(err), 400);
    }
    const t = now();
    const id = db
      .prepare("INSERT INTO mcp_server (owner_account, name, url, token_enc, tools_json, created_at, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(account, body.data.name, url.toString(), token ? sealer.seal(tokenContext(account), token) : null, JSON.stringify(tools), t, t)
      .lastInsertRowid as number;
    log.info("mcp server added", { server_id: id, tools: tools.length });
    return c.json(view(server(deps, account, id)!), 201);
  });

  app.post("/me/mcp/:id/refresh", owner, async (c) => {
    const account = c.get("caller").account;
    const s = server(deps, account, Number(c.req.param("id")));
    if (!s) return c.json({ error: { code: "not_found", message: "No such MCP server" } }, 404);
    try {
      const { url, token } = await resolveServer(deps, account, s);
      const tools = s.catalog_id ? cardTools(s.catalog_id, s.url, await listTools(url, token)) : await listTools(url, token);
      db.prepare("UPDATE mcp_server SET tools_json = ?, refreshed_at = ? WHERE id = ?").run(JSON.stringify(tools), now(), s.id);
    } catch (err) {
      return c.json(fail(err), 400);
    }
    return c.json(view(server(deps, account, s.id)!));
  });

  app.delete("/me/mcp/:id", owner, (c) => {
    const account = c.get("caller").account;
    const id = Number(c.req.param("id"));
    const gone = db.prepare("DELETE FROM mcp_server WHERE id = ? AND owner_account = ?").run(id, account).changes;
    if (!gone) return c.json({ error: { code: "not_found", message: "No such MCP server" } }, 404);
    // proposals for a removed server can no longer run
    db.prepare("UPDATE mcp_task SET status = 'declined', updated_at = ? WHERE server_id = ? AND status = 'pending'").run(now(), id);
    log.info("mcp server removed", { server_id: id });
    return c.json({ ok: true });
  });

  return app;
}

export const mcpModule: Module = { name: "mcp", routes: (deps) => new Hono().route("/", mcpRoutes(deps)) };
