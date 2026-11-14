// Gas relay (brain/src/relay): wallets that sign NEP-366 delegate actions (Meteor, Intear, Ledger,
// Email or Google) send no-deposit calls to our contracts through the brain, which pays the gas.
// Calls with NEAR attached, anything else, or a refusal before sending, sign normally.
import type { NearWalletBase } from "@hot-labs/near-connect";
import { BRAIN_URL, BrainRequestError } from "./brain";
import { DEMO_PETS_CONTRACT, NETWORK, PETS_CONTRACT, SHIRTS_CONTRACT, type Outcome, type TxRequest } from "./chain";
import { authHeaders } from "./session";

const RELAY_RECEIVERS = [PETS_CONTRACT, DEMO_PETS_CONTRACT, SHIRTS_CONTRACT];

/**
 * Only function calls to our contracts with no NEAR attached (1 yocto at most) are relayed; the
 * brain enforces the same. Under NEP-366 the relayer pays attached NEAR, so mint, feed, stake and
 * the like are signed and paid by the user.
 */
export function relayEligible(req: TxRequest): boolean {
  return (
    RELAY_RECEIVERS.includes(req.receiverId) &&
    req.actions.length > 0 &&
    req.actions.every((a) => a.type === "FunctionCall" && BigInt(a.params.deposit) <= 1n)
  );
}

/**
 * True when the brain answered before sending anything (not relayable, daily limit, relay off,
 * no session), so a normal wallet transaction is safe. A 5xx may already be on chain: no retry.
 */
export function relayFallback(status: number): boolean {
  return status === 401 || status === 422 || status === 429 || status === 503;
}

let relayOff = false;

/** The outcome if the brain relayed it, or null to sign normally. Throws on a wallet rejection or a failed relay. */
export async function tryRelay(wallet: NearWalletBase, req: TxRequest): Promise<Outcome | null> {
  if (relayOff || !wallet.manifest.features?.signDelegateActions || !relayEligible(req)) return null;
  const auth = authHeaders();
  if (!auth.Authorization) return null;
  const { signedDelegateActions } = await wallet.signDelegateActions({
    network: NETWORK,
    delegateActions: [{ receiverId: req.receiverId, actions: req.actions as never }],
  });
  const res = await fetch(`${BRAIN_URL}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ signed_delegate: signedDelegateActions[0] }),
  });
  if (res.ok) return (await res.json()) as Outcome;
  if (res.status === 503) relayOff = true;
  if (relayFallback(res.status)) return null;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  throw new BrainRequestError(res.status, body?.error?.code ?? "upstream");
}
