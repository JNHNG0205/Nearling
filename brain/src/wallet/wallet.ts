import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { parsePetRef } from "@nearling/shared";
import { requireCaller, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { publish } from "../events";
import { log } from "../log";
import { createRpc, isAccountId, type NearRpc, type TxStatus } from "./rpc";

/**
 * Wallet approvals (P1, AI-brain 05 section 5). The device starts and reviews, the phone builds
 * the tx only from the approval fields and Meteor signs, the brain checks the tx on chain.
 * Bound to network, account, device, kind, destination and exact amount; one use; 5 min expiry.
 */

export type ApprovalKind = "send" | "stake" | "transfer_pet";
export type ApprovalStatus = "requested" | "approved" | "signed" | "final" | "rejected" | "expired" | "failed";

export interface ApprovalRow {
  id: string;
  kind: ApprovalKind;
  network: "testnet";
  account_id: string;
  device_id: string;
  pet_ref: string | null;
  receiver_id: string;
  amount_yocto: string | null;
  token_id: string | null;
  validator: string | null;
  status: ApprovalStatus;
  tx_hash: string | null;
  last_error: string | null;
  created_at: number;
  approved_at: number | null;
  expires_at: number;
}

export const APPROVAL_TTL_MS = 5 * 60_000;
const TGAS = 10n ** 12n;

/** What the phone must sign, in NEAR Connect action format. Built only from the approval. */
function txPlan(a: ApprovalRow) {
  if (a.kind === "send") {
    return { receiverId: a.receiver_id, actions: [{ type: "Transfer", params: { deposit: a.amount_yocto } }] };
  }
  if (a.kind === "stake") {
    return {
      receiverId: a.validator,
      actions: [{ type: "FunctionCall", params: { methodName: "deposit_and_stake", args: {}, gas: (100n * TGAS).toString(), deposit: a.amount_yocto } }],
    };
  }
  return {
    receiverId: parsePetRef(a.pet_ref ?? "")?.contract ?? null,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: "nft_transfer", args: { receiver_id: a.receiver_id, token_id: a.token_id }, gas: (30n * TGAS).toString(), deposit: "1" },
      },
    ],
  };
}

const view = (a: ApprovalRow) => {
  const { last_error: _e, ...rest } = a;
  return { ...rest, tx: txPlan(a) };
};

/** Does the on-chain tx match the approval exactly? Returns a reason when it does not. */
export function checkApprovalTx(a: ApprovalRow, tx: TxStatus): string | null {
  if (tx.signerId !== a.account_id) return "wrong signer";
  const [act, ...rest] = tx.actions;
  if (!act || rest.length > 0) return "not a single action";
  const amount = a.amount_yocto === null ? null : BigInt(a.amount_yocto);
  if (a.kind === "send") {
    if (tx.receiverId !== a.receiver_id) return "wrong receiver";
    if (act.kind !== "Transfer" || act.deposit !== amount) return "wrong transfer";
    return null;
  }
  if (a.kind === "stake") {
    if (tx.receiverId !== a.validator) return "wrong validator";
    if (act.kind !== "FunctionCall" || act.method !== "deposit_and_stake" || act.deposit !== amount) return "wrong stake call";
    return null;
  }
  const contract = parsePetRef(a.pet_ref ?? "")?.contract;
  if (tx.receiverId !== contract) return "wrong contract";
  if (act.kind !== "FunctionCall" || act.method !== "nft_transfer" || act.deposit !== 1n) return "wrong transfer call";
  const args = act.args as { receiver_id?: unknown; token_id?: unknown } | null;
  if (!args || args.receiver_id !== a.receiver_id || args.token_id !== a.token_id) return "wrong transfer args";
  return null;
}

const err = (c: Context, status: 400 | 403 | 404 | 409 | 410 | 502, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

const Amount = z.string().regex(/^[1-9]\d{0,39}$/);
const CreateBody = z.object({
  kind: z.enum(["send", "stake", "transfer_pet"]),
  receiver_id: z.string(),
  amount_yocto: Amount.optional(),
  token_id: z.string().regex(/^\d+$/).optional(),
  /** owner-started transfer_pet only: which pet (the device route uses its bound pet) */
  pet_ref: z.string().optional(),
});
const RecipientBody = z.object({ label: z.string().min(1).max(32), account_id: z.string() });
const SubmittedBody = z.object({ tx_hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/) });

export function walletRoutes(deps: Deps, over: { rpc?: NearRpc } = {}) {
  const { cfg, db, chain } = deps;
  const rpc = over.rpc ?? createRpc(cfg.NEAR_RPC_URLS);
  const app = new Hono<AuthEnv>();
  const anyCaller = requireCaller(deps);
  const deviceOnly = requireCaller(deps, ["device"]);
  const ownerOnly = requireCaller(deps, ["owner"]);

  const load = (id: string): ApprovalRow | null => {
    const a = (db.prepare("SELECT * FROM approval WHERE id = ?").get(id) as ApprovalRow | undefined) ?? null;
    if (a && (a.status === "requested" || a.status === "approved") && deps.now() > a.expires_at) {
      db.prepare("UPDATE approval SET status = 'expired' WHERE id = ? AND status IN ('requested', 'approved')").run(id);
      announce({ ...a, status: "expired" });
      return { ...a, status: "expired" };
    }
    return a;
  };

  const announce = (a: ApprovalRow) => {
    if (a.pet_ref) publish(a.pet_ref, "approval_status", { id: a.id, kind: a.kind, status: a.status, tx_hash: a.tx_hash });
  };

  const isRecipient = (owner: string, account: string) =>
    !!db.prepare("SELECT 1 FROM wallet_recipient WHERE owner_account = ? AND account_id = ?").get(owner, account);

  // ---------- balances and recipients ----------

  app.get("/wallet", anyCaller, async (c) => {
    const account = c.get("caller").account;
    try {
      const [acct, staked] = await Promise.all([
        rpc.viewAccount(account),
        chain.view<string>(cfg.WALLET_VALIDATOR_POOL, "get_account_staked_balance", { account_id: account }),
      ]);
      return c.json({ account_id: account, liquid_yocto: acct?.amount ?? "0", staked_yocto: String(staked ?? "0"), validator: cfg.WALLET_VALIDATOR_POOL });
    } catch (e) {
      log.warn("wallet balance failed", { error: (e as Error).name });
      return err(c, 502, "upstream", "Could not read balances");
    }
  });

  app.get("/wallet/recipients", anyCaller, (c) =>
    c.json(
      db.prepare("SELECT account_id, label FROM wallet_recipient WHERE owner_account = ? ORDER BY created_at")
        .all(c.get("caller").account),
    ),
  );

  app.post("/wallet/recipients", ownerOnly, async (c) => {
    const body = RecipientBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success || !isAccountId(body.data.account_id)) return err(c, 400, "invalid", "Bad recipient");
    const owner = c.get("caller").account;
    db.prepare(
      `INSERT INTO wallet_recipient (owner_account, account_id, label, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (owner_account, account_id) DO UPDATE SET label = excluded.label`,
    ).run(owner, body.data.account_id, body.data.label, deps.now());
    return c.json(db.prepare("SELECT account_id, label FROM wallet_recipient WHERE owner_account = ? ORDER BY created_at").all(owner));
  });

  // ---------- approvals ----------

  app.post("/approvals", anyCaller, async (c) => {
    const who = c.get("caller");
    const body = CreateBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(c, 400, "invalid", "Bad approval request");
    const { kind, receiver_id, amount_yocto, token_id } = body.data;
    // Build Spec 8: the owner may start a pet transfer on the phone; it still binds to the pet's
    // paired device, and only that device can approve it. Send and stake start on the device only.
    let caller: { account: string; deviceId: string; petRef: string };
    if (who.kind === "device") {
      caller = who;
    } else {
      if (kind !== "transfer_pet" || !body.data.pet_ref) {
        return err(c, 403, "unauthorized", "Start send and stake on your Nearling");
      }
      const dev = db
        .prepare("SELECT id FROM device WHERE pet_ref = ? AND owner_account = ? AND revoked_at IS NULL AND token_hash IS NOT NULL")
        .get(body.data.pet_ref, who.account) as { id: string } | undefined;
      if (!dev) return err(c, 409, "conflict", "Pair a Nearling to approve transfers");
      caller = { account: who.account, deviceId: dev.id, petRef: body.data.pet_ref };
    }
    const ref = parsePetRef(caller.petRef);
    if (!ref) return err(c, 400, "invalid", "Device has no pet");
    const pet = await chain.getPet(ref.contract, ref.tokenId);
    if (!pet || pet.owner !== caller.account) return err(c, 403, "not_owner", "The pet has a new owner");

    let validator: string | null = null;
    if (kind === "send") {
      if (!amount_yocto) return err(c, 400, "invalid", "Amount needed");
      if (receiver_id === caller.account || !isRecipient(caller.account, receiver_id)) {
        return err(c, 400, "invalid", "Pick a saved recipient");
      }
    } else if (kind === "stake") {
      if (!amount_yocto) return err(c, 400, "invalid", "Amount needed");
      if (receiver_id !== cfg.WALLET_VALIDATOR_POOL) return err(c, 400, "invalid", "Unknown validator");
      validator = receiver_id;
    } else {
      if (amount_yocto) return err(c, 400, "invalid", "No amount for a pet transfer");
      if (token_id !== undefined && token_id !== ref.tokenId) return err(c, 400, "invalid", "Only this device's pet");
      if (!isRecipient(caller.account, receiver_id)) return err(c, 400, "invalid", "Pick a saved recipient");
    }

    const now = deps.now();
    const a: ApprovalRow = {
      id: randomUUID(), kind, network: "testnet", account_id: caller.account, device_id: caller.deviceId,
      pet_ref: caller.petRef, receiver_id, amount_yocto: amount_yocto ?? null,
      token_id: kind === "transfer_pet" ? ref.tokenId : null, validator, status: "requested", tx_hash: null,
      last_error: null, created_at: now, approved_at: null, expires_at: now + APPROVAL_TTL_MS,
    };
    db.prepare(
      `INSERT INTO approval (id, kind, network, account_id, device_id, pet_ref, receiver_id, amount_yocto, token_id,
        validator, status, tx_hash, last_error, created_at, approved_at, expires_at)
       VALUES (@id, @kind, @network, @account_id, @device_id, @pet_ref, @receiver_id, @amount_yocto, @token_id,
        @validator, @status, @tx_hash, @last_error, @created_at, @approved_at, @expires_at)`,
    ).run(a);
    log.info("approval requested", { approval_id: a.id, kind, device_id: a.device_id });
    return c.json(view(a), 201);
  });

  /** Device decision. Only the bound device, only from `requested` (reject also from `approved`), before expiry. */
  const decide = (to: "approved" | "rejected") => async (c: Context<AuthEnv>) => {
    const caller = c.get("caller");
    const a = load(c.req.param("id") ?? "");
    if (!a || caller.kind !== "device" || a.device_id !== caller.deviceId) return err(c, 404, "not_found", "No such approval");
    if (a.status === "expired") return err(c, 410, "expired", "This request expired; start again");
    const from = to === "approved" ? ["requested"] : ["requested", "approved"];
    const r = db
      .prepare(`UPDATE approval SET status = ?, approved_at = ? WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`)
      .run(to, to === "approved" ? deps.now() : a.approved_at, a.id, ...from);
    if (r.changes !== 1) return err(c, 409, "conflict", `Approval is ${a.status}`);
    const next = load(a.id)!;
    if (to === "approved" && next.pet_ref) publish(next.pet_ref, "approval_ready", view(next));
    else announce(next);
    log.info(`approval ${to}`, { approval_id: a.id });
    return c.json(view(next));
  };
  app.post("/approvals/:id/approve", deviceOnly, decide("approved"));
  app.post("/approvals/:id/reject", deviceOnly, decide("rejected"));

  app.get("/approvals/:id", anyCaller, (c) => {
    const caller = c.get("caller");
    const a = load(c.req.param("id"));
    const allowed = a && (caller.kind === "device" ? a.device_id === caller.deviceId : a.account_id === caller.account);
    return allowed ? c.json(view(a)) : err(c, 404, "not_found", "No such approval");
  });

  app.post("/approvals/:id/submitted", ownerOnly, async (c) => {
    const caller = c.get("caller");
    const a = load(c.req.param("id"));
    if (!a || a.account_id !== caller.account) return err(c, 404, "not_found", "No such approval");
    const body = SubmittedBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(c, 400, "invalid", "Bad tx hash");
    const { tx_hash } = body.data;

    if (a.status === "final" && a.tx_hash === tx_hash) return c.json(view(a));
    if (a.status === "expired") return err(c, 410, "expired", "This request expired; start again");
    if (a.status === "approved") {
      try {
        const r = db.prepare("UPDATE approval SET status = 'signed', tx_hash = ? WHERE id = ? AND status = 'approved' AND tx_hash IS NULL")
          .run(tx_hash, a.id);
        if (r.changes !== 1) return err(c, 409, "conflict", "Approval already used");
      } catch (e) {
        if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) return err(c, 409, "conflict", "That transaction was already used");
        throw e;
      }
    } else if (!(a.status === "signed" && a.tx_hash === tx_hash)) {
      return err(c, 409, "conflict", `Approval is ${a.status}`);
    }

    let tx: TxStatus | null;
    try {
      tx = await rpc.txStatus(tx_hash, a.account_id);
    } catch (e) {
      log.warn("approval tx lookup failed", { approval_id: a.id, error: (e as Error).name });
      return err(c, 502, "upstream", "Could not check the transaction; try again");
    }
    const signed = load(a.id)!;
    if (!tx) return c.json(view(signed), 202); // not final yet: report again

    const reason = tx.hash !== tx_hash ? "wrong tx" : (checkApprovalTx(signed, tx) ?? (tx.success ? null : "tx failed"));
    const status: ApprovalStatus = reason ? "failed" : "final";
    db.prepare("UPDATE approval SET status = ?, last_error = ? WHERE id = ? AND status = 'signed'").run(status, reason, a.id);
    const done = load(a.id)!;
    announce(done);
    log.info("approval checked", { approval_id: a.id, status, reason });
    if (reason && reason !== "tx failed") return err(c, 400, "invalid", `Transaction does not match the approval (${reason})`);
    return c.json(view(done));
  });

  return new Hono().route("/", app);
}

export function walletModule(over: { rpc?: NearRpc } = {}): Module {
  return { name: "wallet", routes: (deps) => walletRoutes(deps, over) };
}
