"use client";
import { PetPage } from "@/components/wallet/PetPage";
import { Soul } from "@/components/customise/SoulEditor";

// /pet/[petRef]/soul (03 section 7): the public, versioned personality prompt on chain.
export default function SoulPage() {
  return <PetPage title={(n) => `${n}'s Soul`}>{(pet) => <Soul pet={pet} />}</PetPage>;
}
