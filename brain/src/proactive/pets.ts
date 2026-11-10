import { formatPetRef, parsePetRef } from "@nearling/shared";
import type { Deps } from "../deps";
import { log } from "../log";

const PAGE = 50;
const MAX_PAGES = 40; // 2000 pets per contract is far above hackathon scale

export interface KnownPet {
  petRef: string;
  contract: string;
  tokenId: string;
}

/** Every pet the brain should look at: `pet_profile` rows plus `nft_tokens` paging on both contracts. */
export async function listPets(deps: Deps): Promise<KnownPet[]> {
  const refs = new Set(
    (deps.db.prepare("SELECT pet_ref FROM pet_profile").all() as { pet_ref: string }[]).map((r) => r.pet_ref),
  );
  for (const contract of [deps.cfg.PETS_CONTRACT, deps.cfg.DEMO_PETS_CONTRACT]) {
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const tokens = await deps.chain.view<{ token_id: string }[]>(contract, "nft_tokens", {
          from_index: String(page * PAGE),
          limit: PAGE,
        });
        for (const t of tokens) refs.add(formatPetRef(contract, t.token_id));
        if (tokens.length < PAGE) break;
      }
    } catch (err) {
      log.warn("nft_tokens paging failed", { contract, error: err instanceof Error ? err.name : "unknown" });
    }
  }
  const allowed = [deps.cfg.PETS_CONTRACT, deps.cfg.DEMO_PETS_CONTRACT];
  const out: KnownPet[] = [];
  for (const petRef of refs) {
    const ref = parsePetRef(petRef);
    if (ref && allowed.includes(ref.contract)) out.push({ petRef, ...ref });
  }
  return out;
}
