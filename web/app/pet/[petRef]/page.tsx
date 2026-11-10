import { notFound } from "next/navigation";
import { FuelMeter } from "@/components/FuelMeter";
import { BrainRequestError, getPetState } from "@/lib/brain";

// Pet home skeleton (03-pages-and-flows.md section 3). Talk, care and the browser
// Nearling are client components that land next.
export default async function PetHome({ params }: { params: Promise<{ petRef: string }> }) {
  const { petRef } = await params;
  let pet;
  try {
    pet = await getPetState(decodeURIComponent(petRef), { cache: "no-store" });
  } catch (err) {
    if (err instanceof BrainRequestError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-2xl">{pet.name}</h1>
        {pet.demo_speed && (
          <span className="border-2 border-accent px-2 font-display text-sm text-accent">demo speed</span>
        )}
      </header>
      <section className="pixel-panel aspect-square w-[240px] self-center bg-[var(--n-screen)]" aria-label="Pet screen">
        <p className="p-4 font-display text-sm text-muted">{pet.display_state}</p>
      </section>
      <FuelMeter fuel={pet.fuel} />
      <p className="text-sm text-muted">
        {pet.stage} . owner <span className="font-mono">{pet.owner}</span>
      </p>
    </main>
  );
}
