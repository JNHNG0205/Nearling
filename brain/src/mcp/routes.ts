import { Hono } from "hono";
import { z } from "zod";
import { requireCaller, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { jsonBody } from "../identity/common";
import { log } from "../log";
import { checkUrl, listTools, McpError, type McpTool } from "./client";
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
};

const view = (s: ServerRow) => ({
  id: s.id,
  name: s.name,
  url: s.url,
  has_token: s.token_enc !== null,
  tools: (JSON.parse(s.tools_json) as McpTool[]).map((t) => ({ name: t.name, description: t.description })),
  refreshed_at: s.refreshed_at,
});

export function mcpRoutes(deps: Deps) {
  const { cfg, db, sealer, now } = deps;
  const app = new Hono<AuthEnv>();
  const owner = requireCaller(deps, ["owner"]);
  const fail = (err: unknown) => {
    const code = err instanceof McpError ? err.code : "unreachable";
    return { error: { code: "invalid", message: ERRORS[code] } };
  };

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
      const tools = await listTools(await checkUrl(s.url, cfg.MCP_ALLOW_PRIVATE), s.token_enc ? sealer.open(tokenContext(account), s.token_enc) : null);
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
