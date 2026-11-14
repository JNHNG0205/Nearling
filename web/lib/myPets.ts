import { formatPetRef, type PetState } from "@petto/shared";
import { getMyPets, getPetState } from "./brain";
import { isDemoContract, nftTokensForOwner, PET_CONTRACTS } from "./chain";

export interface MyPet {
  ref: string;
  contract: string;
  tokenId: string;
  name: string;
  demo: boolean;
  /** Brain state; null when the brain could not describe this pet. */
  state: PetState | null;
}

const fromState = (s: PetState): MyPet => ({
  ref: s.pet_ref, contract: s.contract, tokenId: s.token_id, name: s.name, demo: s.demo_speed, state: s,
});

/** Owned pets from chain (`nft_tokens_for_owner` on both pets contracts), each with its brain state if available. */
export async function myPetsFromChain(account: string): Promise<MyPet[]> {
  const lists = await Promise.all(
    PET_CONTRACTS.map(async (contract) => (await nftTokensForOwner(contract, account)).map((t) => ({ contract, t }))),
  );
  return Promise.all(
    lists.flat().map(async ({ contract, t }) => {
      const ref = formatPetRef(contract, t.token_id);
      const state = await getPetState(ref, { cache: "no-store" }).catch(() => null);
      return state
        ? fromState(state)
        : { ref, contract, tokenId: t.token_id, name: t.metadata?.title ?? `Pet #${t.token_id}`, demo: isDemoContract(contract), state: null };
    }),
  );
}

/**
 * The brain's `GET /me/pets` when a session exists, else (or when the route is missing or fails)
 * the chain. `source` says which one answered.
 */
export async function loadMyPets(
  account: string,
  headers: Record<string, string>,
): Promise<{ pets: MyPet[]; source: "brain" | "chain" }> {
  if (headers.Authorization) {
    try {
      return { pets: (await getMyPets(headers)).map(fromState), source: "brain" };
    } catch {
      // route not deployed yet (404) or brain unreachable: read the chain
    }
  }
  return { pets: await myPetsFromChain(account), source: "chain" };
}
