/**
 * NEAR Intents 1Click client (AI-brain 04 section 3). Shapes checked on 2026-11-11 against the
 * OpenAPI spec (https://1click.chaindefuser.com/docs/v0/openapi.yaml) and real `dry: true`
 * quotes for Solana USDC -> NEAR (docs/INTEGRATION_PLAN.md "Results", F2). Only the fields we use
 * or show are typed. Without a JWT 1Click adds a 20 bps app fee to every quote.
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
  priceUpdatedAt?: string;
  contractAddress?: string;
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
    /** Only on non-dry quotes. */
    depositAddress?: string;
    depositMemo?: string;
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    /** EXACT_OUTPUT: the least input that still delivers `amountOut`. */
    minAmountIn: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    /** Only on non-dry quotes. */
    deadline?: string;
    timeWhenInactive?: string;
    timeEstimate: number;
    /** Origin-asset units kept if the swap is refunded (about 0.22 USDC on Solana). */
    refundFee?: string;
    withdrawFee?: string;
  };
  quoteRequest: Record<string, unknown>;
  signature: string;
  timestamp: string;
  correlationId: string;
}

/** 1Click swap statuses (OpenAPI `GetExecutionStatusResponse.status`). */
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
  updatedAt?: string;
  correlationId?: string;
  swapDetails?: {
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    nearTxHashes?: string[];
    refundReason?: string;
  };
}

export interface OneClick {
  tokens(): Promise<OneClickToken[]>;
  quote(req: QuoteRequest): Promise<QuoteResponse>;
  status(depositAddress: string): Promise<StatusResponse>;
}

/** NEAR on mainnet as a 1Click destination asset (wNEAR, 24 decimals; seen in /v0/tokens). */
export const NEAR_ASSET = "nep141:wrap.near";
/** USDC on Solana (6 decimals), the default origin for a phone checkout. */
export const SOLANA_USDC_ASSET = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";

export function createOneClick(opts: { baseUrl: string; jwt?: string; liveConfirmed: boolean; fetch?: Fetch }): OneClick {
  const f = opts.fetch ?? (fetch as unknown as Fetch);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.jwt) headers.authorization = `Bearer ${opts.jwt}`;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function req<T>(path: string, init?: { method: string; body: string }): Promise<T> {
    const res = await f(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      // Errors are `{ message }`, e.g. "Amount is too low for bridge, try at least 60417919636664754098360"
      // (route minimum) or "refundTo is not valid". 1Click may also answer 400 "Internal server error"
      // for an address it cannot use (seen with a token mint as refundTo).
      const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
      const msg = typeof body?.message === "string" ? `: ${body.message.slice(0, 200)}` : "";
      throw new Error(`1click http ${res.status}${msg}`);
    }
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
