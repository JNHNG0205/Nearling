import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PetState } from "@nearling/shared";
import { FuelMeter, thoughts } from "@/components/FuelMeter";
import { PetSprite } from "@/components/PetSprite";
import { NearlingFrame } from "@/components/nearling/NearlingFrame";
import { DemoSpeedPill, StatePill } from "@/components/nearling/Pills";
import { VerifyChip } from "@/components/talk/ReceiptCard";
import {
  BrainRequestError, EXPLORER_TX, getPetState, getReceipt, getTimeline, shortHash,
  type Receipt, type TimelineItem,
} from "@/lib/brain";
import { formatNear, timelineLine } from "@/components/nearling/timeline";

export const revalidate = 30;
const CACHE = { next: { revalidate: 30 } };

async function load(ref: string): Promise<PetState> {
  try {
    return await getPetState(ref, CACHE);
  } catch (err) {
    if (err instanceof BrainRequestError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ petRef: string }> }): Promise<Metadata> {
  const ref = decodeURIComponent((await params).petRef);
  try {
    const pet = await getPetState(ref, CACHE);
    return {
      title: `${pet.name}, a Nearling`,
      description: `${pet.name} is a ${pet.stage} Nearling with ${thoughts(pet.fuel.left)} of private AI fuel left. Anyone can feed it NEAR on testnet.`,
    };
  } catch {
    return { title: "A Nearling" };
  }
}

// Public pet page (03-pages section 12): read-only, server rendered, anyone can feed.
export default async function PublicPet({ params }: { params: Promise<{ petRef: string }> }) {
  const ref = decodeURIComponent((await params).petRef);
  const pet = await load(ref);
  const timeline: TimelineItem[] = await getTimeline(ref, CACHE).catch(() => []);
  const published = timeline.filter((t) => t.turn_id && /receipt/.test(t.kind)).slice(0, 3);
  const receipts = (
    await Promise.all(published.map((t) => getReceipt(t.turn_id!, CACHE).catch(() => null)))
  ).filter((r): r is Receipt => r !== null && r.verification.public !== false);
  const events = timeline.filter((t) => !/receipt/.test(t.kind)).slice(0, 12);
  const enc = encodeURIComponent(ref);

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1200px] flex-col gap-12 px-4 py-8 md:px-6">
      <section className="grid items-center gap-8 md:grid-cols-2">
        <div className="flex justify-center">
          <NearlingFrame label={`${pet.name}'s screen`}>
            <PetSprite traits={pet.traits} stageIndex={pet.stage_index} winged={pet.form === "winged"}
              state={pet.display_state} scale={6} label={pet.name} />
          </NearlingFrame>
        </div>
        <div className="flex flex-col gap-4">
          <p className="font-display text-accent">A Nearling on NEAR testnet</p>
          <h1 className="font-display text-[32px] leading-9 font-semibold md:text-[40px] md:leading-[44px]">
            {pet.name}, {pet.stage === "egg" ? "an egg" : `a ${pet.stage}`}{pet.form === "winged" ? " with wings" : ""}
          </h1>
          <div className="flex flex-wrap gap-2">
            {pet.demo_speed && <DemoSpeedPill />}
            <StatePill state={pet.display_state} />
          </div>
          <FuelMeter fuel={pet.fuel} name={pet.name} />
          <p className="max-w-prose text-muted">
            Every reply {pet.name} gives costs one thought of private AI, paid from {pet.name}&apos;s own budget.
            Anyone can feed the brain.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href={`/feed/${enc}`} className="pixel-btn">Feed this pet</Link>
            <Link href="/adopt" className="pixel-btn pixel-btn--secondary">Hatch a pet</Link>
          </div>
          <p className="text-sm text-muted">Owner <span className="font-mono">{pet.owner}</span></p>
        </div>
      </section>

      <section aria-labelledby="receipts" className="flex flex-col gap-4">
        <h2 id="receipts" className="font-display text-2xl">Published receipts</h2>
        {receipts.length === 0 ? (
          <p className="text-muted">The owner has not published a receipt yet. Receipts stay private unless the owner opts in.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-3">
            {receipts.map((r) => (
              <li key={r.turn_id}>
                <Link href={`/receipt/${encodeURIComponent(r.turn_id)}`} className="pixel-panel flex flex-col gap-2 p-3">
                  <VerifyChip status={r.verification.status} />
                  <span className="font-mono text-sm">{r.model} . Soul v{r.soul_version}</span>
                  <span className="font-mono text-sm text-muted">{r.fuel.tx ? `tx ${shortHash(r.fuel.tx)}` : "charging"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="timeline" className="flex flex-col gap-4">
        <h2 id="timeline" className="font-display text-2xl">Timeline</h2>
        {events.length === 0 ? (
          <p className="text-muted">Nothing on the timeline yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {events.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 border-l-2 border-accent pl-3">
                <span>{timelineLine(t)}</span>
                {t.at > 0 && <span className="font-mono text-sm text-muted">{new Date(t.at).toISOString().slice(0, 10)}</span>}
                {t.tx_hash && (
                  <a className="font-mono text-sm text-accent underline underline-offset-4" href={`${EXPLORER_TX}${t.tx_hash}`}
                    target="_blank" rel="noreferrer">tx {shortHash(t.tx_hash)}</a>
                )}
              </li>
            ))}
          </ol>
        )}
        {formatNear(pet.garden.staked_yocto) !== "0" && (
          <p className="text-muted">{formatNear(pet.garden.staked_yocto)} NEAR planted in the Brain Garden.</p>
        )}
      </section>
    </main>
  );
}
