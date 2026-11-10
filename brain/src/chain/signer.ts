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
