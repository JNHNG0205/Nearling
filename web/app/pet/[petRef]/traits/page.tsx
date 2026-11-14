"use client";
import { PetPage } from "@/components/wallet/PetPage";
import { TraitsPanel } from "@/components/nearling/TraitsPanel";

// /pet/[petRef]/traits: the pet's on-chain traits and the battle style they give.
export default function TraitsPage() {
  return (
    <PetPage title={(n) => `${n}'s traits`}>
      {(pet) => <TraitsPanel contract={pet.contract} tokenId={pet.tokenId} traits={pet.chain!.traits} name={pet.chain!.name} />}
    </PetPage>
  );
}
