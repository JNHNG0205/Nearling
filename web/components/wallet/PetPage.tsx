"use client";

import { useParams } from "next/navigation";
import { PetTabs } from "@/components/nearling/PetTabs";
import { petPath } from "@/lib/chain";
import { useSession } from "@/lib/session";
import { AppFrame, ErrorText, Spinner } from "./ui";
import { usePet, type PetData } from "./usePet";

/** Frame for /pet/[petRef]/* and /feed/[petRef]: loads the pet, handles bad refs and loading. */
export function PetPage({
  title,
  back = "home",
  wide,
  children,
}: {
  title: (name: string) => string;
  back?: "home" | "none";
  wide?: boolean;
  children: (pet: PetData) => React.ReactNode;
}) {
  const params = useParams<{ petRef: string }>();
  const pet = usePet(params.petRef ?? "");
  const session = useSession();

  if ("invalid" in pet) {
    return (
      <AppFrame title="Pet not found" back="/">
        <ErrorText>This link doesn't point to a Petto pet.</ErrorText>
      </AppFrame>
    );
  }
  const name = pet.chain?.name ?? "your pet";
  const isOwner = !!session && !!pet.chain && session.account === pet.chain.owner;
  const home = back === "home" ? petPath(pet.contract, pet.tokenId) : undefined;
  return (
    <AppFrame title={title(name)} back={home} demo={pet.demo} wide={wide}>
      <PetTabs petRef={pet.ref} isOwner={isOwner} />
      {pet.loading ? <Spinner /> : pet.chain ? children(pet) : <ErrorText>{pet.error}</ErrorText>}
    </AppFrame>
  );
}
