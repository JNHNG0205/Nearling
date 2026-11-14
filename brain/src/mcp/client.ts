import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Minimal MCP client for the brain (Streamable HTTP). The brain, not the browser or the device,
 * talks to MCP servers, so tokens never leave the server. Every call is time-limited.
 */

export interface McpTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class McpError extends Error {
  constructor(public code: "bad_url" | "private_address" | "unreachable" | "tool_failed") {
    super(`mcp_${code}`);
    this.name = "McpError";
  }
}

const TIMEOUT_MS = 15_000;

/** True for loopback, private, link-local, CGNAT and unique-local addresses (SSRF guard). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]!) : false;
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Rejects anything but a public https URL (unless `allowPrivate`, for tests and a local server). */
export async function checkUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpError("bad_url");
  }
  if (url.username || url.password) throw new McpError("bad_url");
  if (allowPrivate) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new McpError("bad_url");
    return url;
  }
  if (url.protocol !== "https:") throw new McpError("bad_url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new McpError("unreachable");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new McpError("private_address");
  return url;
}

function timeout<T>(p: Promise<T>, code: McpError["code"]): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new McpError(code)), TIMEOUT_MS))]);
}

async function withClient<T>(url: URL, token: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "petto-brain", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  try {
    await timeout(client.connect(transport), "unreachable");
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Connects and returns the server's tools (at most 32, descriptions cut to 300 characters). */
export async function listTools(url: URL, token: string | null): Promise<McpTool[]> {
  return withClient(url, token, async (c) => {
    const { tools } = await timeout(c.listTools(), "unreachable");
    return tools.slice(0, 32).map((t) => ({
      name: t.name,
      description: (t.description ?? "").slice(0, 300),
      input_schema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
    }));
  });
}

/** Calls one tool and returns its text output (at most 4,000 characters). */
export async function callTool(url: URL, token: string | null, tool: string, args: Record<string, unknown>): Promise<string> {
  return withClient(url, token, async (c) => {
    const r = await timeout(c.callTool({ name: tool, arguments: args }), "tool_failed");
    const parts = Array.isArray(r.content) ? r.content : [];
    const text = parts
      .map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n")
      .slice(0, 4_000);
    if (r.isError) throw new McpError("tool_failed");
    return text || "(the tool finished with no text output)";
  });
}
