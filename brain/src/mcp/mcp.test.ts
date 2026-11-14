import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v3"; // the MCP SDK (1.17) validates tool inputs with zod v3 schemas
import type { McpTaskCard, TalkResponse } from "@petto/shared";
import { setVerifyIo } from "../ai/attestation";
import { settleVerifications } from "../ai/verify";
import type { ChatMessage, ChatTool, NearAi } from "../ai/nearai";
import { issueSession } from "../auth/guard";
import { createApp } from "../app";
import { testDeps } from "../test/deps";
import { createTalk } from "../talk/talk";
import { checkUrl, isPrivateAddress } from "./client";
import { mcpModule } from "./routes";

// A real MCP server on localhost: one tool that books a calendar slot and records what it got.
const booked: { title: string; when: string }[] = [];
let http: Server;
let mcpUrl = "";
beforeAll(async () => {
  http = createServer(async (req, res) => {
    const server = new McpServer({ name: "calendar", version: "1.0.0" });
    // typed loosely: the SDK's deep zod generics overflow tsc in a test file
    const shape: Record<string, unknown> = { title: z.string(), when: z.string() };
    (server.tool as (...a: unknown[]) => void)("book_event", "Book a calendar event", shape, async ({ title, when }: { title: string; when: string }) => {
      booked.push({ title, when });
      return { content: [{ type: "text", text: `Booked "${title}" at ${when}.` }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    let body = "";
    for await (const chunk of req) body += chunk;
    await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
  });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  mcpUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});
afterAll(() => new Promise<void>((ok) => http.close(() => ok())));

let t = 1_800_000_000_000;
beforeEach(() => {
  t = 1_800_000_000_000;
  booked.length = 0;
  setVerifyIo({ fetch: (async () => { throw new Error("offline"); }) as typeof fetch, sleep: async () => undefined });
});
afterEach(async () => {
  await settleVerifications();
  setVerifyIo();
});

/** Model stand-in: proposes the tool when it was offered one, otherwise replies in words. */
function toolAi() {
  const seen: { tools: ChatTool[] | undefined; messages: ChatMessage[] }[] = [];
  const ai: NearAi = {
    async chat(messages, o = {}) {
      seen.push({ tools: o.tools, messages });
      const fn = o.tools?.[0]?.function.name;
      const text = fn ? "" : "[happy] All done, it is on your calendar!";
      return {
        text, model: "Qwen/Qwen3.6-35B-A3B-FP8", chatId: `c${seen.length}`, inferenceId: null,
        rawRequest: "{}", rawResponse: "{}", usage: { prompt_tokens: 10, completion_tokens: 5 }, ms: 5,
        ...(fn ? { toolCalls: [{ name: fn, arguments: { title: "Dentist", when: "Tue 17 Nov 15:00" } }, { name: "s99_not_connected", arguments: {} }] } : {}),
      };
    },
    async transcribe() { return { text: "", ms: 0 }; },
    async modelPrices() { return new Map(); },
    async checkModel() { return { inputNano: 1, outputNano: 1, verifiable: true }; },
  };
  return { ai, seen };
}

async function setup() {
  const deps = testDeps({ now: () => t });
  deps.cfg = { ...deps.cfg, MCP_ALLOW_PRIVATE: true };
  const { ai, seen } = toolAi();
  const talk = createTalk(deps, { ai, tts: null });
  const mcp = createApp(deps, [mcpModule]);
  const { token } = await issueSession(deps, "alice.testnet");
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const post = (app: { request: typeof talk.app.request }, path: string, body: object = {}) =>
    app.request(path, { method: "POST", headers: auth, body: JSON.stringify(body) });
  return { deps, talk, mcp, auth, seen, post };
}

describe("MCP url guard", () => {
  it("knows private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  it("accepts only public https unless private is allowed", async () => {
    await expect(checkUrl("http://example.com/mcp", false)).rejects.toThrow("mcp_bad_url");
    await expect(checkUrl("https://127.0.0.1/mcp", false)).rejects.toThrow("mcp_private_address");
    await expect(checkUrl("https://user:pw@example.com/mcp", false)).rejects.toThrow("mcp_bad_url");
    await expect(checkUrl("not a url", false)).rejects.toThrow("mcp_bad_url");
    expect((await checkUrl("http://127.0.0.1:9/mcp", true)).hostname).toBe("127.0.0.1");
  });
});

describe("MCP servers and tasks", () => {
  it("connects a server, then the pet proposes, the owner approves, the tool runs once and the pet reports", async () => {
    const { deps, talk, mcp, seen, post } = await setup();

    // connect: the brain lists the server's tools and never returns the token
    const added = await post(mcp, "/me/mcp", { name: "Calendar", url: mcpUrl, token: "secret-token" });
    expect(added.status).toBe(201);
    const srv = (await added.json()) as { id: number; has_token: boolean; tools: { name: string }[] };
    expect(srv).toMatchObject({ has_token: true, tools: [{ name: "book_event" }] });
    expect(JSON.stringify(srv)).not.toContain("secret-token");

    // chat: the model is offered the tool; only the connected tool becomes a task, nothing runs yet
    const r = await post(talk.app, "/pets/pets.petto.testnet:1/talk", { request_id: "req-mcp-0001", text: "Book my dentist on Tuesday at 3pm" });
    const body = (await r.json()) as TalkResponse;
    expect(seen[0]!.tools?.map((x) => x.function.name)).toEqual([`s${srv.id}_book_event`]);
    expect(seen[0]!.messages[0]!.content).toContain("approves every tool call");
    expect(body.reply).toMatch(/approve/i);
    expect(body.tasks).toHaveLength(1);
    const task = body.tasks![0]!;
    expect(task).toMatchObject({ server: "Calendar", tool: "book_event", args: { title: "Dentist", when: "Tue 17 Nov 15:00" }, status: "pending" });
    expect(booked).toHaveLength(0);

    // approve: runs the tool once, then a follow-up turn (no tools offered) tells the owner
    t += 1_000; // inside the 3 s gap on purpose: follow-ups are not rate limited
    const ok = await post(talk.app, `/pets/pets.petto.testnet:1/tasks/${task.id}/approve`);
    expect(ok.status).toBe(200);
    const out = (await ok.json()) as { task: McpTaskCard; turn: TalkResponse };
    expect(booked).toEqual([{ title: "Dentist", when: "Tue 17 Nov 15:00" }]);
    expect(out.task.status).toBe("done");
    expect(out.turn.reply).toContain("calendar");
    expect(out.task.follow_turn_id).toBe(out.turn.turn_id);
    expect(seen[1]!.tools).toBeUndefined();
    expect(seen[1]!.messages.at(-1)!.content).toContain('Booked "Dentist"');

    // a second approve (double click, second device) is refused and never runs the tool again
    expect((await post(talk.app, `/pets/pets.petto.testnet:1/tasks/${task.id}/approve`)).status).toBe(409);
    expect(booked).toHaveLength(1);

    // arguments, results and the token are stored sealed, not in plain text
    const raw = JSON.stringify(deps.db.prepare("SELECT * FROM mcp_task").all()) + JSON.stringify(deps.db.prepare("SELECT * FROM mcp_server").all());
    expect(raw).not.toContain("Dentist");
    expect(raw).not.toContain("secret-token");
  });

  it("decline never runs the tool; another owner cannot touch the task", async () => {
    const { deps, talk, mcp, post } = await setup();
    await post(mcp, "/me/mcp", { name: "Calendar", url: mcpUrl });
    const r = (await (await post(talk.app, "/pets/pets.petto.testnet:1/talk", { request_id: "req-mcp-0002", text: "Book it" })).json()) as TalkResponse;
    const id = r.tasks![0]!.id;

    const { token } = await issueSession(deps, "mallory.testnet");
    const stranger = await talk.app.request(`/pets/pets.petto.testnet:1/tasks/${id}/approve`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect([403, 404]).toContain(stranger.status);

    const no = await post(talk.app, `/pets/pets.petto.testnet:1/tasks/${id}/decline`);
    expect(((await no.json()) as { task: McpTaskCard }).task.status).toBe("declined");
    expect((await post(talk.app, `/pets/pets.petto.testnet:1/tasks/${id}/approve`)).status).toBe(409);
    expect(booked).toHaveLength(0);
  });

  it("without connected servers the model gets no tools; bad servers are refused", async () => {
    const { talk, mcp, seen, post } = await setup();
    await post(talk.app, "/pets/pets.petto.testnet:1/talk", { request_id: "req-mcp-0003", text: "hi" });
    expect(seen[0]!.tools).toBeUndefined();
    const bad = await post(mcp, "/me/mcp", { name: "Nope", url: "http://127.0.0.1:1/mcp" });
    expect(bad.status).toBe(400);
    expect((await mcp.request("/me/mcp")).status).toBe(401); // signed out
  });
});

describe("MCP catalog and sign-in", () => {
  async function app() {
    const deps = testDeps({ now: () => t });
    const mcp = createApp(deps, [mcpModule]);
    const { token } = await issueSession(deps, "alice.testnet");
    const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const connect = async (body: object) => {
      const r = await mcp.request("/me/mcp/connect", { method: "POST", headers: h, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as { error?: { message: string }; authorize_url?: string } };
    };
    return { deps, mcp, connect };
  }

  it("lists every tool with how it connects, without endpoints or secrets", async () => {
    const { mcp } = await app();
    const { tools } = (await (await mcp.request("/mcp/catalog")).json()) as { tools: { id: string; auth: string; available: boolean }[] };
    const by = Object.fromEntries(tools.map((x) => [x.id, x]));
    for (const id of ["gmail", "gcal", "slack", "notion", "canva", "firecrawl", "playwright", "deepwiki"]) expect(by[id]).toBeDefined();
    expect(by.gmail).toMatchObject({ auth: "oauth", available: false }); // no Google app in the test config
    expect(by.notion).toMatchObject({ auth: "oauth", available: true }); // registers itself
    expect(by.firecrawl).toMatchObject({ auth: "key", available: true });
    expect(by.playwright).toMatchObject({ auth: "local", available: false });
    expect(JSON.stringify(tools)).not.toMatch(/firecrawl\.dev\/\{key\}|client_secret/);
  });

  it("refuses what cannot connect, with a reason", async () => {
    const { connect } = await app();
    expect(await connect({ id: "firecrawl" })).toMatchObject({ status: 400, body: { error: { message: expect.stringMatching(/API key/) } } });
    expect(await connect({ id: "gmail" })).toMatchObject({ status: 400, body: { error: { message: expect.stringMatching(/not set up/) } } });
    expect((await connect({ id: "playwright" })).status).toBe(400);
    expect((await connect({ id: "nope" })).status).toBe(400);
  });

  it("the sign-in callback only accepts a live state, and sends the browser back to the web page", async () => {
    const { mcp } = await app();
    const bogus = await mcp.request("/mcp/oauth/callback?state=forged&code=abc");
    expect(bogus.status).toBe(302);
    expect(bogus.headers.get("location")).toMatch(/^http:\/\/localhost:3000\/mcp\?mcp_error=/);
    const cancelled = await mcp.request("/mcp/oauth/callback?state=x&error=access_denied");
    expect(decodeURIComponent(cancelled.headers.get("location") ?? "")).toContain("cancelled");
  });

  it("puts an API key in the server path, never in the stored address", async () => {
    const { deps } = await app();
    const { resolveServer, sealAuth } = await import("./auth");
    const row = { id: 1, owner_account: "alice.testnet", name: "Firecrawl", url: "https://mcp.firecrawl.dev/mcp", token_enc: sealAuth(deps, "alice.testnet", { kind: "path_key", key: "fc-123" }), tools_json: "[]", catalog_id: "firecrawl", created_at: 0, refreshed_at: 0 };
    const { url, token } = await resolveServer(deps, "alice.testnet", row);
    expect(url.toString()).toBe("https://mcp.firecrawl.dev/fc-123/v2/mcp");
    expect(token).toBeNull();
    expect(row.url).not.toContain("fc-123");
  });
});
