/**
 * Raw NEAR JSON-RPC reads the Chain view helper does not cover: transaction status (to verify
 * what a client says it signed) and account balances. Testnet only. Injectable fetch for tests.
 */

export type TxAction =
  | { kind: "Transfer"; deposit: bigint }
  | { kind: "FunctionCall"; method: string; args: unknown; deposit: bigint }
  | { kind: "Other"; name: string };

export interface TxEvent {
  executor: string;
  standard: string;
  event: string;
  data: unknown;
}

export interface TxStatus {
  hash: string;
  signerId: string;
  receiverId: string;
  actions: TxAction[];
  /** Final execution status is SuccessValue. */
  success: boolean;
  events: TxEvent[];
}

export interface NearRpc {
  /** null = not known yet (not found or not final within the RPC wait). Throws on RPC outage. */
  txStatus(txHash: string, senderId: string): Promise<TxStatus | null>;
  /** null = account does not exist. `amount` is liquid yocto. */
  viewAccount(accountId: string): Promise<{ amount: string } | null>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface RpcReply {
  result?: unknown;
  error?: { name?: string; cause?: { name?: string }; message?: string; data?: unknown };
}

const NOT_YET = new Set(["UNKNOWN_TRANSACTION", "TIMEOUT_ERROR"]);

export function createRpc(urls: string[], fetchImpl: Fetch = fetch as unknown as Fetch): NearRpc {
  async function call(method: string, params: unknown): Promise<RpcReply> {
    let last: unknown = new Error("no RPC urls");
    for (const url of urls) {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "nearling", method, params }),
        });
        if (!res.ok) throw new Error(`rpc http ${res.status}`);
        return (await res.json()) as RpcReply;
      } catch (err) {
        last = err; // network or HTTP error: try the next RPC
      }
    }
    throw last;
  }

  return {
    async txStatus(txHash, senderId) {
      const r = await call("tx", { tx_hash: txHash, sender_account_id: senderId, wait_until: "FINAL" });
      if (r.error) {
        const name = r.error.cause?.name ?? r.error.name ?? "";
        if (NOT_YET.has(name)) return null;
        throw new Error(`rpc tx error ${name}`);
      }
      return parseTxStatus(r.result);
    },

    async viewAccount(accountId) {
      const r = await call("query", { request_type: "view_account", finality: "final", account_id: accountId });
      if (r.error) {
        const name = r.error.cause?.name ?? r.error.name ?? "";
        if (name === "UNKNOWN_ACCOUNT") return null;
        throw new Error(`rpc view_account error ${name}`);
      }
      const amount = (r.result as { amount?: string } | undefined)?.amount;
      return amount === undefined ? null : { amount };
    },
  };
}

interface RawTx {
  transaction?: { hash?: string; signer_id?: string; receiver_id?: string; actions?: unknown[] };
  status?: unknown;
  receipts_outcome?: { outcome?: { logs?: string[]; executor_id?: string } }[];
}

/** Normalises an RPC `tx` result. Exported for tests that build fixtures. */
export function parseTxStatus(raw: unknown): TxStatus | null {
  const r = raw as RawTx | undefined;
  const t = r?.transaction;
  if (!t?.hash || !t.signer_id || !t.receiver_id) return null;
  const status = r?.status;
  // Not final yet ("NotStarted" / "Started"): treat as unknown, the caller retries later.
  if (typeof status === "string") return null;
  const success = !!status && typeof status === "object" && "SuccessValue" in status;
  return {
    hash: t.hash,
    signerId: t.signer_id,
    receiverId: t.receiver_id,
    actions: (t.actions ?? []).map(parseAction),
    success,
    events: (r?.receipts_outcome ?? []).flatMap((o) =>
      (o.outcome?.logs ?? []).flatMap((l) => {
        if (!l.startsWith("EVENT_JSON:")) return [];
        try {
          const e = JSON.parse(l.slice("EVENT_JSON:".length)) as { standard: string; event: string; data: unknown };
          return [{ executor: o.outcome?.executor_id ?? "", standard: e.standard, event: e.event, data: e.data }];
        } catch {
          return [];
        }
      }),
    ),
  };
}

function toBig(v: unknown): bigint {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return -1n;
  }
}

function parseAction(a: unknown): TxAction {
  if (typeof a === "string") return { kind: "Other", name: a };
  const o = a as Record<string, Record<string, unknown> | undefined>;
  if (o.Transfer) return { kind: "Transfer", deposit: toBig(o.Transfer.deposit) };
  if (o.FunctionCall) {
    let args: unknown = null;
    try {
      args = JSON.parse(Buffer.from(String(o.FunctionCall.args ?? ""), "base64").toString("utf8"));
    } catch {
      args = null;
    }
    return { kind: "FunctionCall", method: String(o.FunctionCall.method_name ?? ""), args, deposit: toBig(o.FunctionCall.deposit) };
  }
  return { kind: "Other", name: Object.keys(o)[0] ?? "unknown" };
}

/** True for a NEAR account id we accept as a destination (named or 64-hex implicit). */
export function isAccountId(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length >= 2 &&
    s.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s)
  );
}

/** Splits a comma-separated key list (also accepts an already-split array). */
export function splitKeys(v: string | string[] | undefined): string[] {
  const list = Array.isArray(v) ? v : (v ?? "").split(",");
  return list.map((k) => k.trim()).filter(Boolean);
}
