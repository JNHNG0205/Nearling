import { describe, expect, it } from "vitest";
import type { ChatTool, NearAi } from "../ai/nearai";
import type { OwnerTools } from "../mcp/store";
import { testDeps } from "../test/deps";
import { JUST_CHAT, plan } from "./planner";

const spec = (name: string): ChatTool => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } });

/** Scripted planner model: returns the next pick each call and records what it was offered. */
function scripted(picks: { name: string; arguments?: Record<string, unknown> }[]) {
  const offered: { tools?: ChatTool[]; toolChoice?: string; system: string }[] = [];
  let i = 0;
  const ai = {
    async chat(messages, o = {}) {
      offered.push({ tools: o.tools, toolChoice: o.toolChoice, system: messages[0]!.content });
      const p = picks[Math.min(i++, picks.length - 1)]!;
      return { text: "", toolCalls: [{ name: p.name, arguments: p.arguments ?? {} }], model: "m", chatId: "c", inferenceId: null, rawRequest: "", rawResponse: "", usage: { prompt_tokens: 1, completion_tokens: 1 }, ms: 1 };
    },
  } as NearAi;
  return { ai, offered, calls: () => i };
}

const tools: OwnerTools = {
  specs: [spec("s1_discover"), spec("s1_execute_write")],
  byName: new Map([
    ["s1_discover", { serverId: 1, tool: "discover", serverName: "Zapier", lookup: true }],
    ["s1_execute_write", { serverId: 1, tool: "execute_write", serverName: "Zapier", lookup: false }],
  ]),
};
const base = { owner: "alice.testnet", turnId: "t", model: "m", tools, history: [], userText: "Book dentist tomorrow 3pm", local: { time: "Sat 19:00 (UTC)", day: "2026-11-14" } };

describe("agent planner", () => {
  it("must pick a tool or just_chat, with the date in its instructions", async () => {
    const s = scripted([{ name: "just_chat" }]);
    const r = await plan(testDeps(), s.ai, base);
    expect(r).toEqual({ calls: [], looked: [], chat: true });
    expect(s.offered[0]!.toolChoice).toBe("required");
    expect(s.offered[0]!.tools?.map((t) => t.function.name)).toEqual(["s1_discover", "s1_execute_write", JUST_CHAT.function.name]);
    expect(s.offered[0]!.system).toContain("2026-11-14");
  });

  it("an action is returned for Approve, never run by the planner", async () => {
    const s = scripted([{ name: "s1_execute_write", arguments: { title: "Dentist" } }]);
    const r = await plan(testDeps(), s.ai, base);
    expect(r.calls).toEqual([{ serverId: 1, tool: "execute_write", serverName: "Zapier", lookup: false, args: { title: "Dentist" } }]);
  });

  it("does not repeat the same look-up forever", async () => {
    const s = scripted([{ name: "s1_discover", arguments: { app: "Calendar" } }]); // always the same pick
    const r = await plan(testDeps(), s.ai, base); // the look-up itself fails here (no server row): that is fine
    expect(r.looked).toEqual(["discover"]);
    expect(s.calls()).toBe(3); // repeat -> one more decision with only actions offered
    expect(s.offered[2]!.tools?.map((t) => t.function.name)).toEqual(["s1_execute_write", "just_chat"]);
    expect(r.chat).toBe(false);
  });
});
