/**
 * NEAR Intents 1Click client (AI-brain 04 section 3). Every request and response shape here is
 * [VERIFY] against https://docs.near-intents.org before any live use.
 *
 * Safety (CLAUDE.md rule 1): a non-dry quote creates a real mainnet deposit address. This client
 * refuses `dry: false` unless INTENTS_LIVE_CONFIRMED=1, which only a human sets.
 */

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
}

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_OUTPUT";
  slippageTolerance: number; // basis points
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string; // EXACT_OUTPUT: smallest units of the destination asset
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string; // ISO time
}

export interface QuoteResponse {
  quote: {
    depositAddress?: string;
    amountIn: string;
    amountInFormatted?: string;
    amountOut: string;
    amountOutFormatted?: string;
    deadline?: string;
    timeEstimate?: number;
  };
  signature?: string;
  timestamp?: string;
}

/** 1Click swap statuses. [VERIFY] the full list. */
export type OneClickStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export interface StatusResponse {
  status: OneClickStatus;
  swapDetails?: { originChainTxHashes?: { hash: string }[]; destinationChainTxHashes?: { hash: string }[] };
}

export interface OneClick {
  tokens(): Promise<OneClickToken[]>;
  quote(req: QuoteRequest): Promise<QuoteResponse>;
  status(depositAddress: string): Promise<StatusResponse>;
}

/** NEAR on mainnet as a 1Click destination asset. [VERIFY] */
export const NEAR_ASSET = "nep141:wrap.near";

export function createOneClick(opts: { baseUrl: string; jwt?: string; liveConfirmed: boolean; fetch?: Fetch }): OneClick {
  const f = opts.fetch ?? (fetch as unknown as Fetch);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.jwt) headers.authorization = `Bearer ${opts.jwt}`;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function req<T>(path: string, init?: { method: string; body: string }): Promise<T> {
    const res = await f(`${base}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`1click http ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    tokens: () => req<OneClickToken[]>("/v0/tokens"),
    quote(q) {
      if (!q.dry && !opts.liveConfirmed) {
        return Promise.reject(new Error("live 1Click quotes need INTENTS_LIVE_CONFIRMED=1 (human only)"));
      }
      return req<QuoteResponse>("/v0/quote", { method: "POST", body: JSON.stringify(q) });
    },
    status: (depositAddress) =>
      req<StatusResponse>(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`),
  };
}
