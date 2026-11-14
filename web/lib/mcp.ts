// Brain calls for web /mcp (connect MCP servers) and for approving the pet's proposed tool calls.
import type { McpTaskCard, TalkResponse } from "@petto/shared";
import { BRAIN_URL } from "./brain";
import { clearSession } from "./session";

export interface McpServerView {
  id: number;
  name: string;
  url: string;
  has_token: boolean;
  catalog_id: string | null;
  tools: { name: string; description: string }[];
  refreshed_at: number;
}

/** A failed call, with the brain's own message (it explains what to fix). */
export class McpRequestError extends Error {}

async function call<T>(path: string, headers: Record<string, string>, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BRAIN_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { ...headers, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (res.status === 401) {
    clearSession(); // stale sign-in: the page falls back to "Sign in to Petto"
    throw new McpRequestError("Your sign-in expired. Sign in again to manage tools.");
  }
  if (!res.ok) throw new McpRequestError(body?.error?.message ?? "Petto's brain could not do that. Try again.");
  return body as T;
}

export const listMcp = (h: Record<string, string>) => call<{ servers: McpServerView[] }>("/me/mcp", h).then((r) => r.servers);
export const addMcp = (h: Record<string, string>, body: { name: string; url: string; token?: string }) =>
  call<McpServerView>("/me/mcp", h, { method: "POST", body });
export const refreshMcp = (h: Record<string, string>, id: number) => call<McpServerView>(`/me/mcp/${id}/refresh`, h, { method: "POST", body: {} });
export const removeMcp = (h: Record<string, string>, id: number) => call<{ ok: true }>(`/me/mcp/${id}`, h, { method: "DELETE" });

/** Approve runs the tool on the brain, then the pet replies about the result (`turn`). */
export const decideTask = (h: Record<string, string>, petRef: string, taskId: string, decision: "approve" | "decline", voice = true) =>
  call<{ task: McpTaskCard; turn?: TalkResponse }>(
    `/pets/${encodeURIComponent(petRef)}/tasks/${encodeURIComponent(taskId)}/${decision}`,
    h,
    { method: "POST", body: { voice } },
  );

/** One ready-made tool on /mcp, from the brain's catalog. */
export interface CatalogTool {
  id: string;
  name: string;
  what: string;
  try: string;
  auth: "none" | "key" | "oauth" | "local";
  key_name?: string;
  key_url?: string;
  help?: string;
  /** false: sign-in app not set up on this Petto yet, or runs locally only */
  available: boolean;
  /** "Zapier": connects through Zapier's MCP (Gmail, Calendar, Slack without the team's own app) */
  via?: string;
}

export const getCatalog = async () =>
  ((await (await fetch(`${BRAIN_URL}/mcp/catalog`)).json()) as { tools: CatalogTool[] }).tools;

/** Open and key tools connect at once; sign-in tools return the provider's sign-in link. */
export const connectTool = (h: Record<string, string>, id: string, key?: string) =>
  call<McpServerView & { authorize_url?: string }>("/me/mcp/connect", h, { method: "POST", body: { id, ...(key ? { key } : {}) } });
