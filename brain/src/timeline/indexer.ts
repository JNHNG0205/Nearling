import { formatPetRef } from "@nearling/shared";

/**
 * Reads the pets contracts' EVENT_JSON logs from the FastNEAR transactions API (testnet, keyless).
 * Docs: https://tx.test.fastnear.com (source github.com/fastnear/explorer-api).
 *   POST /v0/account       { account_id, desc: false, from_tx_block_height, limit, resume_token } -> tx hashes
 *   POST /v0/transactions  { tx_hashes: [...] (max 20) } -> raw txs with every receipt's outcome and logs
 *   POST /v0/blocks        { limit: 1 } -> latest indexed block (staleness check)
 * Chosen over NearBlocks v3, whose account listings carry no logs or args and ignore `per_page`.
 */

export const FASTNEAR_TX_URL = "https://tx.test.fastnear.com";
const TIMEOUT_MS = 10_000;
const PAGE = 200; // API max
const MAX_PAGES = 10; // 2000 txs per contract per pass; the cursor resumes next pass
const TX_BATCH = 20; // API max

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class IndexerError extends Error {
  override name = "IndexerError";
}

export interface AccountTx {
  transaction_hash: string;
  tx_block_height: number;
  tx_block_timestamp: string;
}

interface Outcome {
  logs: string[];
  executor_id: string;
  status: Record<string, unknown>;
}

/** `execution_outcome.id` is the receipt id. */
interface RawReceipt {
  execution_outcome: { id: string; block_timestamp: number | string; outcome: Outcome };
}

export interface RawTx {
  transaction: { hash: string; signer_id: string };
  receipts: RawReceipt[];
}

/** One timeline row parsed from a log. `petRef` is the bare contract id for contract-wide events. */
export interface ParsedEvent {
  petRef: string;
  kind: string;
  actor: string | null;
  amount: string | null;
  txHash: string;
  receiptId: string;
  logIndex: number;
  blockTs: number;
  raw: Record<string, unknown>;
}

async function post<T>(f: Fetch, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await f(`${FASTNEAR_TX_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new IndexerError(`${path} unreachable`);
  }
  if (!res.ok) throw new IndexerError(`${path} HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Timestamp (ms) of the newest block the indexer has, to notice a stalled indexer. */
export async function latestIndexedMs(f: Fetch): Promise<number> {
  const r = await post<{ blocks?: { block_timestamp: string }[] }>(f, "/v0/blocks", { limit: 1 });
  const ts = r.blocks?.[0]?.block_timestamp;
  if (!ts) throw new IndexerError("/v0/blocks empty");
  return Number(BigInt(ts) / 1_000_000n);
}

/** Txs touching `account` from `fromHeight` up, oldest first. */
export async function listAccountTxs(f: Fetch, account: string, fromHeight: number): Promise<AccountTx[]> {
  const out: AccountTx[] = [];
  let resume: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await post<{ account_txs?: AccountTx[]; resume_token?: string }>(f, "/v0/account", {
      account_id: account,
      desc: false,
      from_tx_block_height: fromHeight,
      limit: PAGE,
      ...(resume ? { resume_token: resume } : {}),
    });
    if (!Array.isArray(r.account_txs)) throw new IndexerError("/v0/account bad shape");
    out.push(...r.account_txs);
    resume = r.resume_token;
    if (!resume) break;
  }
  return out;
}

export async function fetchTxs(f: Fetch, hashes: string[]): Promise<RawTx[]> {
  const out: RawTx[] = [];
  for (let i = 0; i < hashes.length; i += TX_BATCH) {
    const r = await post<{ transactions?: RawTx[] }>(f, "/v0/transactions", { tx_hashes: hashes.slice(i, i + TX_BATCH) });
    if (!Array.isArray(r.transactions)) throw new IndexerError("/v0/transactions bad shape");
    out.push(...r.transactions);
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);
const succeeded = (o: Outcome) => "SuccessValue" in o.status || "SuccessReceiptId" in o.status;

/** nearling events shown on the timeline; others (played, device_*, action_*) are left out. */
const NEARLING_KINDS = new Set([
  "fed", "thought", "staked", "staked_from_food", "unstaked", "unstake_withdrawn",
  "soul_updated", "stage_up", "dormant", "revived", "credit_swept",
]);

/** Row fields for one nearling event item. Never copies the soul prompt or usage refs. */
function nearlingRow(kind: string, d: Record<string, unknown>, signer: string) {
  switch (kind) {
    case "fed": return { actor: str(d.by), amount: str(d.amount), raw: {} };
    case "thought": return { actor: signer, amount: str(d.cost_micro), raw: { source: d.source ?? null } };
    case "staked":
    case "unstake_withdrawn": return { actor: str(d.owner) ?? signer, amount: str(d.amount), raw: {} };
    case "staked_from_food": return { actor: signer, amount: str(d.amount), raw: {} };
    case "unstaked": return { actor: signer, amount: str(d.amount), raw: { pending: d.pending ?? null } };
    case "soul_updated": return { actor: signer, amount: str(d.version), raw: {} };
    case "stage_up": return { actor: null, amount: str(d.stage), raw: {} };
    case "credit_swept": return { actor: signer, amount: null, raw: {} };
    default: return { actor: null, amount: null, raw: {} }; // dormant, revived
  }
}

/** Every timeline row in `tx` from successful receipts executed by `contract`. */
export function parseTx(tx: RawTx, contract: string): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  const signer = tx.transaction.signer_id;
  for (const r of tx.receipts ?? []) {
    const o = r.execution_outcome?.outcome;
    const receiptId = r.execution_outcome?.id;
    if (!o || !receiptId || o.executor_id !== contract || !succeeded(o)) continue;
    const blockTs = Math.floor(Number(r.execution_outcome.block_timestamp) / 1e6);
    o.logs.forEach((line, logIndex) => {
      if (!line.startsWith("EVENT_JSON:")) return;
      let ev: { standard?: string; event?: string; data?: unknown };
      try {
        ev = JSON.parse(line.slice("EVENT_JSON:".length));
      } catch {
        return;
      }
      const items = Array.isArray(ev.data) ? (ev.data as Record<string, unknown>[]) : [];
      const base = { txHash: tx.transaction.hash, receiptId, logIndex, blockTs };
      if (ev.standard === "nearling" && ev.event && NEARLING_KINDS.has(ev.event)) {
        for (const d of items) {
          const petId = str(d.pet_id);
          const petRef = ev.event === "credit_swept" ? contract : petId ? formatPetRef(contract, petId) : null;
          if (petRef) out.push({ ...base, petRef, kind: ev.event, ...nearlingRow(ev.event, d, signer) });
        }
      } else if (ev.standard === "nep171" && (ev.event === "nft_mint" || ev.event === "nft_transfer")) {
        for (const d of items) {
          const ids = Array.isArray(d.token_ids) ? d.token_ids.map(String) : [];
          for (const id of ids) {
            const petRef = formatPetRef(contract, id);
            if (ev.event === "nft_mint") {
              out.push({ ...base, petRef, kind: "minted", actor: str(d.owner_id), amount: null, raw: {} });
            } else {
              const to = str(d.new_owner_id);
              out.push({ ...base, petRef, kind: "owner_changed", actor: to, amount: null, raw: { from: str(d.old_owner_id), to } });
            }
          }
        }
      }
    });
  }
  return out;
}
