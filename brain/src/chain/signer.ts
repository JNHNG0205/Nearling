import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from "near-api-js";

/**
 * Signs function calls for one account (brain or feeder). One serial lane per access key, so
 * concurrent calls never clash on nonces (AI-brain 04 section 2). Testnet only.
 */
export interface CallResult {
  txHash: string;
  /** `EVENT_JSON:` payloads from every receipt log, parsed. */
  events: { standard: string; event: string; data: unknown }[];
  /** Raw logs, for anything else. */
  logs: string[];
}

export interface TxSigner {
  accountId: string;
  call(contractId: string, methodName: string, args: Record<string, unknown>, opts?: { gasTgas?: number; depositYocto?: bigint }): Promise<CallResult>;
}

export function createSigner(accountId: string, keys: string[], rpcUrl: string): TxSigner | null {
  if (!accountId || keys.length === 0) return null;
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const lanes = keys.map((k) => ({
    account: new Account(accountId, provider, KeyPairSigner.fromSecretKey(k as KeyPairString)),
    tail: Promise.resolve() as Promise<unknown>,
  }));
  let next = 0;

  return {
    accountId,
    call(contractId, methodName, args, opts = {}) {
      const lane = lanes[next++ % lanes.length]!;
      const run = lane.tail.then(async (): Promise<CallResult> => {
        const res = await lane.account.callFunctionRaw({
          contractId,
          methodName,
          args,
          gas: BigInt(opts.gasTgas ?? 30) * 10n ** 12n,
          deposit: opts.depositYocto ?? 0n,
        });
        return parseOutcome(res as unknown as RawOutcome);
      });
      lane.tail = run.catch(() => undefined); // a failure must not block the lane
      return run;
    },
  };
}

/** Brain signers per pets contract (B4): a function-call key works for one receiver only. */
export interface BrainSigners {
  /** The one shared signer for this contract (same lanes for charges and sweeps), or null without keys. */
  forContract(contractId: string): TxSigner | null;
}

interface BrainKeyConfig {
  BRAIN_ACCOUNT_ID: string;
  PETS_CONTRACT: string;
  DEMO_PETS_CONTRACT: string;
  BRAIN_KEYS: string[];
  BRAIN_KEYS_PETS: string[];
  BRAIN_KEYS_DEMO: string[];
  NEAR_RPC_URLS: string[];
}

/**
 * Built once in server.ts. `BRAIN_KEYS_PETS` (fallback `BRAIN_KEYS`) sign for PETS_CONTRACT,
 * `BRAIN_KEYS_DEMO` for DEMO_PETS_CONTRACT. Any other contract gets null.
 */
export function createBrainSigners(cfg: BrainKeyConfig, make: typeof createSigner = createSigner): BrainSigners {
  const rpc = cfg.NEAR_RPC_URLS[0] ?? "https://rpc.testnet.near.org";
  const byContract = new Map<string, TxSigner | null>();
  byContract.set(cfg.DEMO_PETS_CONTRACT, make(cfg.BRAIN_ACCOUNT_ID, cfg.BRAIN_KEYS_DEMO, rpc));
  // PETS last, so it wins if both names point at the same contract.
  const petsKeys = cfg.BRAIN_KEYS_PETS.length > 0 ? cfg.BRAIN_KEYS_PETS : cfg.BRAIN_KEYS;
  byContract.set(cfg.PETS_CONTRACT, make(cfg.BRAIN_ACCOUNT_ID, petsKeys, rpc));
  return { forContract: (id) => byContract.get(id) ?? null };
}

interface RawOutcome {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  receipts_outcome?: { outcome?: { logs?: string[] } }[];
}

export function parseOutcome(res: RawOutcome): CallResult {
  const logs = (res.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? []);
  const events = logs
    .filter((l) => l.startsWith("EVENT_JSON:"))
    .flatMap((l) => {
      try {
        const e = JSON.parse(l.slice("EVENT_JSON:".length)) as { standard: string; event: string; data: unknown };
        return [e];
      } catch {
        return [];
      }
    });
  return { txHash: res.transaction?.hash ?? res.transaction_outcome?.id ?? "", events, logs };
}
