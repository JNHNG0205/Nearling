import { Hono } from "hono";
import type { InboxItem } from "@nearling/shared";
import { requirePetAccess, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { publish } from "../events";

interface InboxRow {
  id: number;
  pet_ref: string;
  trigger: string;
  text_enc: Buffer;
  turn_id: string | null;
  created_at: number;
  delivered_device_at: number | null;
  read_at: number | null;
}

const PAGE = 50;

function toItem(deps: Deps, r: InboxRow): InboxItem {
  return {
    id: r.id,
    trigger: r.trigger.replace(/:canned$/, ""),
    canned: r.turn_id === null,
    text: deps.sealer.open(r.pet_ref, r.text_enc),
    turn_id: r.turn_id,
    created_at: r.created_at,
    delivered_device_at: r.delivered_device_at,
    read_at: r.read_at,
  };
}

/**
 * Adds a message from the pet to its owner's inbox (text sealed at rest) and pushes SSE `inbox`.
 * Any module may call this (fed thanks, race results, evolution). Pass `turnId` only when an
 * inference produced the text.
 */
export function pushInbox(
  deps: Deps,
  petRef: string,
  owner: string,
  trigger: string,
  text: string,
  turnId?: string,
): InboxItem {
  const res = deps.db
    .prepare("INSERT INTO inbox (pet_ref, owner_account, trigger, text_enc, turn_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(petRef, owner, trigger, deps.sealer.seal(petRef, text), turnId ?? null, deps.now());
  const row = deps.db.prepare("SELECT * FROM inbox WHERE id = ?").get(res.lastInsertRowid) as InboxRow;
  const item = toItem(deps, row);
  publish(petRef, "inbox", { ...item });
  return item;
}

export function inboxRoutes(deps: Deps) {
  const app = new Hono<AuthEnv>();

  // Inbox rows belong to the owner they were written for, so a new owner never sees old messages.
  app.get("/pets/:petRef/inbox", requirePetAccess(deps), (c) => {
    const after = Number(c.req.query("after") ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      return c.json({ error: { code: "invalid", message: "after must be an inbox id" } }, 400);
    }
    const rows = deps.db
      .prepare("SELECT * FROM inbox WHERE pet_ref = ? AND owner_account = ? AND id > ? ORDER BY id LIMIT ?")
      .all(c.req.param("petRef"), c.get("caller").account, after, PAGE) as InboxRow[];
    return c.json(rows.map((r) => toItem(deps, r)));
  });

  // Device ack = delivered (bounce + chime played); owner ack = read.
  app.post("/pets/:petRef/inbox/ack", requirePetAccess(deps), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { up_to?: unknown } | null;
    const upTo = body?.up_to;
    if (typeof upTo !== "number" || !Number.isInteger(upTo) || upTo < 0) {
      return c.json({ error: { code: "invalid", message: "up_to must be an inbox id" } }, 400);
    }
    const caller = c.get("caller");
    const col = caller.kind === "device" ? "delivered_device_at" : "read_at";
    deps.db
      .prepare(`UPDATE inbox SET ${col} = ? WHERE pet_ref = ? AND owner_account = ? AND id <= ? AND ${col} IS NULL`)
      .run(deps.now(), c.req.param("petRef"), caller.account, upTo);
    return c.json({ ok: true });
  });

  return new Hono().route("/", app);
}

export const inboxModule: Module = { name: "inbox", routes: inboxRoutes };
