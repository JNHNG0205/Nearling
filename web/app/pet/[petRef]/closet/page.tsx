"use client";
import { OwnerGate } from "@/components/wallet/OwnerGate";
import { PetHeader } from "@/components/wallet/PetHeader";
import { PetPage } from "@/components/wallet/PetPage";
import { Closet } from "@/components/customise/ClosetPicker";

// /pet/[petRef]/closet (03 section 6, Build Spec 5).
export default function ClosetPage() {
  return (
    <PetPage title={(n) => `${n}'s closet`}>
      {(pet) => (
        <>
          <PetHeader pet={pet} />
          <OwnerGate owner={pet.chain!.owner} name={pet.chain!.name}>
            <Closet pet={pet} />
          </OwnerGate>
        </>
      )}
    </PetPage>
  );
}
