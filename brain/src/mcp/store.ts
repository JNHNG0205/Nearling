import type { McpTaskCard } from "@petto/shared";
import type { ChatTool } from "../ai/nearai";
import type { Deps } from "../deps";
import type { McpTool } from "./client";
import { ZAPIER_LOOKUP, ZAPIER_MCP_URL } from "./catalog";

/** Sealer context for an owner's MCP tokens (the sealer derives a key per context string). */
export const tokenContext = (owner: string) => `mcp:${owner}`;

export interface ServerRow {
  id: number;
  owner_account: string;
  name: string;
  url: string;
  token_enc: Buffer | null;
  tools_json: string;
  /** catalog tool id (web /mcp cards); null for a server the owner typed in */
  catalog_id: string | null;
  created_at: number;
  refreshed_at: number;
}

export interface TaskRow {
  id: string;
  turn_id: string;
  pet_ref: string;
  owner_account: string;
  server_id: number;
  tool: string;
  args_enc: Buffer;
  status: "pending" | "approved" | "done" | "failed" | "declined";
  result_enc: Buffer | null;
  error_code: string | null;
  follow_turn_id: string | null;
  created_at: number;
  updated_at: number;
}

export const servers = (deps: Deps, owner: string) =>
  deps.db.prepare("SELECT * FROM mcp_server WHERE owner_account = ? ORDER BY id").all(owner) as ServerRow[];

export const server = (deps: Deps, owner: string, id: number) =>
  deps.db.prepare("SELECT * FROM mcp_server WHERE id = ? AND owner_account = ?").get(id, owner) as ServerRow | undefined;

/** The model sees each tool as `s<serverId>_<tool>` (OpenAI names: letters, digits, _ and -, at most 64). */
const fnName = (serverId: number, tool: string) => `s${serverId}_${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);

export interface OwnerTools {
  specs: ChatTool[];
  byName: Map<string, { serverId: number; tool: string; serverName: string; lookup: boolean }>;
}

/** Every tool the owner connected, as chat tools (at most 32 in total). Null when there are none. */
export function ownerTools(deps: Deps, owner: string): OwnerTools | null {
  const specs: ChatTool[] = [];
  const byName: OwnerTools["byName"] = new Map();
  const all = servers(deps, owner);
  const seen = new Set<string>();
  for (const s of all) {
    // Gmail, Calendar and Slack through Zapier share one connection: offer its actions once
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    const zapier = s.url === ZAPIER_MCP_URL;
    const label = zapier ? `Zapier (${all.filter((x) => x.url === s.url).map((x) => x.name).join(", ")})` : s.name;
    for (const t of JSON.parse(s.tools_json) as McpTool[]) {
      if (specs.length >= 32) break;
      const name = fnName(s.id, t.name);
      byName.set(name, { serverId: s.id, tool: t.name, serverName: label, lookup: zapier && ZAPIER_LOOKUP.has(t.name) });
      specs.push({ type: "function", function: { name, description: `${label}: ${t.description}`.slice(0, 400), parameters: t.input_schema } });
    }
  }
  return specs.length ? { specs, byName } : null;
}

export function taskCard(deps: Deps, row: TaskRow): McpTaskCard {
  const srv = deps.db.prepare("SELECT name FROM mcp_server WHERE id = ?").get(row.server_id) as { name: string } | undefined;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(deps.sealer.open(row.pet_ref, row.args_enc)) as Record<string, unknown>;
  } catch {
    args = {};
  }
  const error = row.status === "failed" && row.result_enc ? deps.sealer.tryOpen(row.pet_ref, row.result_enc)?.slice(0, 400) : undefined;
  return { id: row.id, server: srv?.name ?? "removed tool", tool: row.tool, args, status: row.status, follow_turn_id: row.follow_turn_id, ...(error ? { error } : {}) };
}

export const tasksForTurn = (deps: Deps, turnId: string) =>
  (deps.db.prepare("SELECT * FROM mcp_task WHERE turn_id = ? ORDER BY created_at").all(turnId) as TaskRow[]).map((r) => taskCard(deps, r));

/**
 * Always in the system prompt of an owner chat: which tools the pet really has, and what to do when
 * asked for a real-world task without one (say so plainly; never pretend or change the subject).
 */
export function capabilityNote(deps: Deps, owner: string): string {
  const list = servers(deps, owner).map((s) => {
    const n = (JSON.parse(s.tools_json) as McpTool[]).length;
    return n ? `${s.name} (${n} actions)` : `${s.name} (connected, but no actions are enabled yet)`;
  });
  return [
    "Real-world tasks (calendar, email, messages, documents, web pages): you can only do them with a connected tool.",
    `- Connected tools: ${list.length ? list.join(", ") : "none"}.`,
    "- If the owner asks for something none of your tools can do, do not pretend and do not change the subject. Reply in one or two short sentences:",
    "  - if no tool for it is connected, say you can't do that yet and that they can connect it on the \"MCP\" page of the Petto app (not on the device);",
    "  - if the tool is connected but has no actions enabled, say its actions are not turned on yet: they should turn them on in Zapier, then press Refresh on the MCP page.",
    "- Never say you did something you did not do.",
  ].join("\n");
}
