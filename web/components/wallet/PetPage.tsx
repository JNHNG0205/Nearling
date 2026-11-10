"use client";

import { useParams } from "next/navigation";
import { petPath } from "@/lib/chain";
import { AppFrame, ErrorText, Spinner } from "./ui";
import { usePet, type PetData } from "./usePet";

/** Frame for /pet/[petRef]/* and /feed/[petRef]: loads the pet, handles bad refs and loading. */
export function PetPage({
  title,
  back = "home",
  children,
}: {
  title: (name: string) => string;
  back?: "home" | "none";
  children: (pet: PetData) => React.ReactNode;
}) {
  const params = useParams<{ petRef: string }>();
  const pet = usePet(params.petRef ?? "");

  if ("invalid" in pet) {
    return (
      <AppFrame title="Pet not found" back="/">
        <ErrorText>This link doesn't point to a Nearling pet.</ErrorText>
      </AppFrame>
    );
  }
  const name = pet.chain?.name ?? "your pet";
  return (
    <AppFrame title={title(name)} back={back === "home" ? petPath(pet.contract, pet.tokenId) : undefined} demo={pet.demo}>
      {pet.loading ? <Spinner /> : pet.chain ? children(pet) : <ErrorText>{pet.error}</ErrorText>}
    </AppFrame>
  );
}
