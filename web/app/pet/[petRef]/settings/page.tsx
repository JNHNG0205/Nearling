"use client";
import { OwnerGate } from "@/components/wallet/OwnerGate";
import { PetHeader } from "@/components/wallet/PetHeader";
import { PetPage } from "@/components/wallet/PetPage";
import { ProfileForm } from "@/components/customise/ProfileForm";

// /pet/[petRef]/settings: what the pet calls its owner and the owner's clock (LIMITATIONS A9, A10).
export default function SettingsPage() {
  return (
    <PetPage title={() => "Settings"}>
      {(pet) => (
        <>
          <PetHeader pet={pet} />
          <OwnerGate owner={pet.chain!.owner} name={pet.chain!.name}>
            <ProfileForm pet={pet} />
          </OwnerGate>
        </>
      )}
    </PetPage>
  );
}
