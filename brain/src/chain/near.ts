import { JsonRpcProvider } from "near-api-js";
import type { PetView, SoulView } from "@nearling/shared";

/** Subset of the pets contract `config()` view the brain reads. */
export interface PetsConfig {
  fuel_price_micro: number;
  near_usd_rate_micro: number;
  farm_rate_micro_per_near_day: number;
  demo_speed: boolean;
}

export interface Chain {
  getPet(contract: string, tokenId: string): Promise<PetView | null>;
  getConfig(contract: string): Promise<PetsConfig>;
  /** Pet Soul (public prompt). Cached per pet for 30 s; key by soul_version when it matters. */
  getSoul(contract: string, tokenId: string): Promise<SoulView>;
  /** Any view call (shirts, NEARON pool, validator pools...). Throws on contract panics. */
  view<T>(contractId: string, method: string, args?: Record<string, unknown>): Promise<T>;
}

const PET_TTL_MS = 5_000;
const CONFIG_TTL_MS = 60_000;

/** A contract panic (e.g. `E_UNKNOWN_PET: ...`) is an answer, not an RPC outage. */
export function isContractPanic(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("GuestPanic") || /\bE_[A-Z_]+:/.test(msg);
}

export function createChain(rpcUrls: string[]): Chain {
  // Our own failover instead of FailoverRpcProvider: that one wraps contract panics
  // and retries them on every RPC with backoff, turning a missing pet into a slow 502.
  const providers = rpcUrls.map((url) => new JsonRpcProvider({ url }));
  const pets = new Map<string, { at: number; value: PetView | null }>();
  const configs = new Map<string, { at: number; value: PetsConfig }>();
  const souls = new Map<string, { at: number; value: SoulView }>();

  async function view<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
    // Two rounds over all providers: public testnet RPCs drop requests now and then
    // ("TypeError: fetch failed", HTTP 429), and both failing at once was seen in the logs.
    let last: unknown;
    for (let round = 0; round < 2; round++) {
      if (round > 0) await new Promise((ok) => setTimeout(ok, 400));
      for (const p of providers) {
        try {
          return (await p.callFunction({ contractId, method, args })) as T;
        } catch (err) {
          if (isContractPanic(err)) throw err;
          last = err;
        }
      }
    }
    throw last;
  }

  return {
    async getPet(contract, tokenId) {
      const key = `${contract}:${tokenId}`;
      const hit = pets.get(key);
      if (hit && Date.now() - hit.at < PET_TTL_MS) return hit.value;
      let value: PetView | null;
      try {
        value = await view<PetView>(contract, "get_pet", { pet_id: tokenId });
      } catch (err) {
        // The contract panics with E_UNKNOWN_PET for a missing token.
        if (isContractPanic(err) && String(err).includes("E_UNKNOWN_PET")) value = null;
        else throw err;
      }
      pets.set(key, { at: Date.now(), value });
      return value;
    },

    async getSoul(contract, tokenId) {
      const key = `${contract}:${tokenId}`;
      const hit = souls.get(key);
      if (hit && Date.now() - hit.at < 30_000) return hit.value;
      const value = await view<SoulView>(contract, "get_soul", { pet_id: tokenId });
      souls.set(key, { at: Date.now(), value });
      return value;
    },

    view: (contractId, method, args = {}) => view(contractId, method, args),

    async getConfig(contract) {
      const hit = configs.get(contract);
      if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.value;
      const value = await view<PetsConfig>(contract, "config", {});
      configs.set(contract, { at: Date.now(), value });
      return value;
    },
  };
}
