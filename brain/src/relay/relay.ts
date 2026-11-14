// Gas relay (NEP-366 meta transactions): the user's wallet signs a delegate action, the brain's
// relayer account wraps it in its own transaction and pays the gas. Under NEP-366 the relayer would
// also pay any NEAR attached, so only calls with none (1 yocto at most) are relayed. Only calls to
// our own contracts, from the signed-in account, within caps.
import { Hono, type Context } from "hono";
import { deserialize } from "borsh";
import { Account, JsonRpcProvider, KeyPairSigner, SCHEMA, actions, type KeyPairString } from "near-api-js";
import { requireCaller, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { jsonBody } from "../identity/common";
import { log } from "../log";

const TGAS = 10n ** 12n;
const DAY_MS = 86_400_000;

/** A borsh-decoded `SignedDelegate` (near-api-js SCHEMA): u64 / u128 fields are bigint. */
export interface DecodedDelegate {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: Array<{ functionCall?: { methodName: string; gas: bigint; deposit: bigint } } & Record<string, unknown>>;
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: unknown;
  };
  signature: unknown;
}

export interface Relayer {
  accountId: string;
  /** Sends the delegate in a transaction from the relayer; resolves with the final outcome. */
  send(d: DecodedDelegate): Promise<unknown>;
}

/** Throws unless `b64` is exactly one borsh `SignedDelegate`. */
export function decodeSignedDelegate(b64: string): DecodedDelegate {
  return deserialize(SCHEMA.SignedDelegate, Buffer.from(b64, "base64")) as unknown as DecodedDelegate;
}

/** Why the brain will not pay for this delegate, or null when it will. */
export function relayRefusal(
  d: DecodedDelegate,
  p: { account: string; receivers: string[]; maxGasTgas: bigint },
): string | null {
  const { senderId, receiverId, actions: acts } = d.delegateAction;
  if (senderId !== p.account) return "The sender must be the signed-in account";
  if (!p.receivers.includes(receiverId)) return "The receiver must be a Petto contract";
  if (acts.length === 0 || !acts.every((a) => a.functionCall)) return "Only function calls are relayed";
  // NEP-366: NEAR attached to the inner calls is paid by the relayer, not the user. Only the
  // 1 yocto that NEP-171 transfers need is allowed; anything else the user signs and pays.
  if (acts.some((a) => a.functionCall!.deposit > 1n)) return "Calls with NEAR attached are not relayed";
  const gas = acts.reduce((sum, a) => sum + a.functionCall!.gas, 0n);
  if (gas > p.maxGasTgas * TGAS) return `At most ${p.maxGasTgas} Tgas of gas is relayed`;
  return null;
}

interface ReceiptOutcome {
  id: string;
  outcome: { executor_id: string; status: Record<string, unknown>; receipt_ids: string[] };
}

/**
 * The status of the user's actual call inside a relayed transaction. The top-level status only
 * covers the relayer's delegate receipt (success even when the contract panicked), so start at
 * the delegate's child run by `receiverId` and follow `SuccessReceiptId`, as NEAR does for a
 * normal transaction. Null when the outcome does not have that shape.
 */
export function innerStatus(outcome: unknown, receiverId: string): Record<string, unknown> | null {
  const o = outcome as { transaction_outcome?: { outcome?: { status?: { SuccessReceiptId?: string } } }; receipts_outcome?: ReceiptOutcome[] };
  const byId = new Map((o.receipts_outcome ?? []).map((r) => [r.id, r]));
  const delegate = byId.get(o.transaction_outcome?.outcome?.status?.SuccessReceiptId ?? "");
  let r = delegate?.outcome.receipt_ids.map((id) => byId.get(id)).find((x) => x?.outcome.executor_id === receiverId);
  for (let hops = 0; r && hops < 32; hops++) {
    const next = r.outcome.status.SuccessReceiptId;
    if (typeof next !== "string") return r.outcome.status;
    r = byId.get(next);
  }
  return null;
}

/** One serial lane on the relayer's full access key, so relays never clash on nonces. */
export function createRelayer(accountId: string, key: string, rpcUrl: string): Relayer | null {
  if (!accountId || !key) return null;
  const account = new Account(accountId, new JsonRpcProvider({ url: rpcUrl }), KeyPairSigner.fromSecretKey(key as KeyPairString));
  let tail: Promise<unknown> = Promise.resolve();
  return {
    accountId,
    send(d) {
      const run = tail.then(() =>
        account.signAndSendTransaction({
          receiverId: d.delegateAction.senderId,
          actions: [actions.signedDelegate(d as unknown as Parameters<typeof actions.signedDelegate>[0])],
          // a contract panic comes back as an outcome, so the web shows its usual E_ copy
          throwOnFailure: false,
        }),
      );
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

const refuse = (c: Context, status: 422 | 429 | 503 | 502, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

/** Outcomes can carry bigint after near-api-js parsing; send them as strings. */
const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export function relayRoutes(deps: Deps, relayer: Relayer | null, opts: { perDay: number }) {
  const app = new Hono<AuthEnv>();
  const used = new Map<string, number>(); // `${utc day}:${account}` -> relays

  app.post("/relay", requireCaller(deps, ["owner"]), async (c) => {
    // 422 / 429 / 503 are refusals before anything is sent: the web then signs normally.
    if (!relayer) return refuse(c, 503, "relay_off", "Gas relay is not set up");
    const account = c.get("caller").account;
    const body = (await jsonBody(c)) as { signed_delegate?: unknown } | null;
    let d: DecodedDelegate;
    try {
      if (typeof body?.signed_delegate !== "string") throw new Error("missing");
      d = decodeSignedDelegate(body.signed_delegate);
    } catch {
      return refuse(c, 422, "not_relayable", "Expected signed_delegate: a base64 NEP-366 SignedDelegate");
    }
    const why = relayRefusal(d, {
      account,
      receivers: [deps.cfg.PETS_CONTRACT, deps.cfg.DEMO_PETS_CONTRACT, deps.cfg.SHIRTS_CONTRACT],
      maxGasTgas: 650n,
    });
    if (why) return refuse(c, 422, "not_relayable", why);
    const key = `${Math.floor(deps.now() / DAY_MS)}:${account}`;
    const n = used.get(key) ?? 0;
    if (n >= opts.perDay) return refuse(c, 429, "relay_limit", "Daily gas relay limit reached");
    used.set(key, n + 1);

    const method = d.delegateAction.actions[0]?.functionCall?.methodName;
    try {
      const outcome = await relayer.send(d);
      const status = innerStatus(outcome, d.delegateAction.receiverId);
      log.info("relayed", { account, receiver: d.delegateAction.receiverId, method, ok: !status || !("Failure" in status) });
      // the web reads `status` like a normal transaction's: the user's call, not the relayer's wrapper
      return c.json(toJson(status ? { ...(outcome as object), status } : outcome));
    } catch (err) {
      // May already be on chain: never let the web retry this as a normal transaction.
      log.warn("relay_failed", { account, method, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
      return refuse(c, 502, "upstream", "The relay could not send this transaction");
    }
  });

  return app;
}

export const relayModule: Module = {
  name: "relay",
  routes: (deps) =>
    new Hono().route(
      "/",
      relayRoutes(deps, createRelayer(deps.cfg.RELAYER_ACCOUNT_ID, deps.cfg.RELAYER_KEY, deps.cfg.NEAR_RPC_URLS[0]!), {
        perDay: deps.cfg.RELAY_DAILY_PER_ACCOUNT,
      }),
    ),
};
