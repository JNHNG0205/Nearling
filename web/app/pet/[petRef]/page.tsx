import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PetHome } from "@/components/nearling/PetHome";
import { BrainRequestError, getPetState } from "@/lib/brain";

export const metadata: Metadata = { title: "Pet home . Nearling" };

// Pet home (03-pages-and-flows.md section 3, design.md 6.2): browser Nearling, fuel, talk, care.
export default async function PetPage({ params }: { params: Promise<{ petRef: string }> }) {
  const { petRef } = await params;
  let pet;
  try {
    pet = await getPetState(decodeURIComponent(petRef), { cache: "no-store" });
  } catch (err) {
    if (err instanceof BrainRequestError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
  return <PetHome initial={pet} />;
}
