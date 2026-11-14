import Link from "next/link";
import type { ReactNode } from "react";
import { PetSprite } from "@/components/PetSprite";
import { CountUp } from "@/components/nearling/CountUp";
import { DemoPet } from "@/components/nearling/DemoPet";
import { GardenPlot } from "@/components/nearling/GardenPlot";
import { NearlingFrame } from "@/components/nearling/NearlingFrame";
import { ReceiptCard } from "@/components/talk/ReceiptCard";
import { DEMO_PET_REF, getPublicReceipts } from "@/lib/brain";
import { getConfig, PETS_CONTRACT } from "@/lib/chain";

// Landing (design.md 6.1): one section per screen, hero alone on the first screen.

const DEMO_HREF = `/pet/${encodeURIComponent(DEMO_PET_REF)}`;

const STEPS: { title: string; body: string; anim: "eat" | "talk" | "starving" }[] = [
  { title: "Feed", body: "Anyone sends NEAR to the pet. It lands in the pet's own budget on chain.", anim: "eat" },
  { title: "Talk", body: "Hold to talk. A private model on NEAR AI writes the reply in the pet's voice.", anim: "talk" },
  { title: "Pay", body: "The pet pays one thought from its budget. With no fuel left, it falls asleep.", anim: "starving" },
];

function Screen({ id, label, children, className = "" }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-label={label} className={`flex min-h-dvh items-center border-t-2 border-line py-16 ${className}`}>
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-4 md:grid-cols-2 md:px-6">{children}</div>
    </section>
  );
}

export const revalidate = 60;

export default async function Home() {
  // A real receipt the demo pet's owner published; the card is hidden when there is none.
  const receipt = (await getPublicReceipts(DEMO_PET_REF, { next: { revalidate: 60 } }).catch(() => []))[0] ?? null;
  // Garden numbers come from the pets contract config; hidden if NEAR testnet does not answer.
  const config = await getConfig(PETS_CONTRACT).catch(() => null);
  return (
    <>
      <main>
        <section aria-label="Petto" className="flex min-h-[calc(100dvh-64px)] items-center py-12">
          <div className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-4 md:grid-cols-2 md:px-6">
            <div className="flex flex-col gap-6">
              <h1 className="font-display text-[32px] leading-9 font-semibold md:text-[40px] md:leading-[44px]">
                Petto, a pixel pet that pays for its own AI
              </h1>
              <p className="max-w-xl text-lg">
                Every reply costs $0.001 of private AI, paid from the pet&apos;s own NEAR budget on testnet.
              </p>
              <p className="max-w-xl text-muted">
                Feed it and it thinks. Ignore it and the fuel runs out. The pet beside this text runs at demo speed,
                so you can watch its budget drop.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/start" className="pixel-btn">Get started</Link>
                <Link href={DEMO_HREF} className="pixel-btn pixel-btn--secondary">Watch the demo pet</Link>
              </div>
            </div>
            <div className="flex justify-center">
              <DemoPet />
            </div>
          </div>
        </section>

        <Screen id="how" label="How it works">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl md:text-[28px] md:leading-8">Feed it NEAR, it thinks, it pays</h2>
            <p className="max-w-prose text-muted">
              Fuel lives on chain, so the pet&apos;s life is in its own wallet.
            </p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="pixel-panel flex flex-col items-center gap-3 p-4 text-center">
                <PetSprite traits={[i * 3, 0, i, 0, 0]} stageIndex={2} winged={false}
                  state={s.anim === "starving" ? "starving" : "happy"} play={s.anim === "starving" ? null : s.anim}
                  playKey={s.anim} scale={3} label={`${s.title} step`} />
                <span className="font-display text-lg">{i + 1}. {s.title}</span>
                <span className="text-sm">{s.body}</span>
              </li>
            ))}
          </ol>
        </Screen>

        <Screen id="body" label="The device">
          <div className="flex justify-center md:order-2">
            <figure className="flex flex-col items-center gap-3">
              <NearlingFrame label="The desk Petto">
                <PetSprite traits={[5, 0, 2, 0, 0]} stageIndex={3} winged state="happy" play="rock" playKey="body"
                  scale={6} label="A winged Petto rocking" />
              </NearlingFrame>
              <figcaption className="text-sm text-muted">Pixel render of the device until photos of the printed body are ready.</figcaption>
            </figure>
          </div>
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl md:text-[28px] md:leading-8">A desk Petto you pat, rock and race</h2>
            <p className="max-w-prose">
              The same pet lives in a small ESP32 body with a 240 pixel screen, buttons, a touch pad and a speaker.
              Pat it, rock it to sleep or race a friend&apos;s Petto. Care works offline and costs no fuel.
              Wallet actions wait until you hold Approve on the device.
            </p>
          </div>
        </Screen>

        <Screen id="receipts" label="Private replies">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl md:text-[28px] md:leading-8">Every reply comes with a receipt</h2>
            <p className="max-w-prose">
              Replies run on a private model inside a trusted execution environment. The brain checks the GPU
              attestation, then checks the signature on the reply. The receipt names the model and the Soul version,
              links the fuel charge and lists what it did not check.
            </p>
            <Link href="/privacy" className="pixel-btn pixel-btn--secondary self-start">Read what is verified</Link>
          </div>
          {receipt && <ReceiptCard receipt={receipt} />}
        </Screen>

        <Screen id="garden" label="Brain Garden">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl md:text-[28px] md:leading-8">Plant 10 NEAR and it feeds itself</h2>
            <p className="max-w-prose">
              Stake NEAR for your pet through NEARON. The staking yield turns into NEAR AI credit, and the pet spends
              credit before food. Once credit covers the daily burn, the pet earns the self-sustaining badge.
            </p>
          </div>
          <div className="pixel-panel flex flex-col items-center gap-4 p-6">
            <GardenPlot />
            {config && config.fuel_price_micro > 0 && (
              <>
                <p className="font-display text-sm text-muted">10 NEAR planted grows</p>
                <p className="font-mono text-[40px] leading-[44px] text-fuel">
                  +<CountUp to={(10 * config.farm_rate_micro_per_near_day) / config.fuel_price_micro} decimals={2} />
                </p>
                <p className="font-display">thoughts per day</p>
                <p className="text-sm text-muted">
                  At the contract&apos;s NEARON rate of {config.farm_rate_micro_per_near_day} micro-USD per NEAR per day.
                </p>
              </>
            )}
          </div>
        </Screen>

        <section aria-label="Hatch a pet" className="flex min-h-dvh flex-col items-center justify-center gap-8 border-t-2 border-line px-4 py-16 text-center">
          <p className="font-display text-[64px] leading-[64px] font-bold md:text-[128px] md:leading-[128px]">Petto</p>
          <p className="max-w-md text-muted">Testnet only. NEAR here has no real value, and fuel is granted on testnet.</p>
          <Link href="/adopt" className="pixel-btn">Hatch a pet</Link>
        </section>
      </main>

      <footer className="border-t-2 border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-6 text-sm text-muted md:flex-row md:items-center md:justify-between md:px-6">
          <nav aria-label="Footer" className="flex gap-6">
            <Link href="/adopt" className="hover:text-accent">Hatch</Link>
            <Link href={DEMO_HREF} className="hover:text-accent">Demo pet</Link>
            <Link href="/privacy" className="hover:text-accent">Privacy</Link>
          </nav>
          <p>Built at NEAR HACKATHON, 2026. Fonts: Pixelify Sans, Figtree and DM Mono (SIL Open Font License).</p>
        </div>
      </footer>
    </>
  );
}
