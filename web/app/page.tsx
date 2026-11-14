import Link from "next/link";
import type { ReactNode } from "react";
import { COSTUME_KEYS, type AnyAnim } from "@petto/sprites";
import { PetSprite } from "@/components/PetSprite";
import { Parade } from "@/components/landing/Parade";
import { CountUp } from "@/components/nearling/CountUp";
import { DemoPet } from "@/components/nearling/DemoPet";
import { NearlingFrame } from "@/components/nearling/NearlingFrame";
import { ReceiptCard } from "@/components/talk/ReceiptCard";
import { DEMO_PET_REF, getPublicReceipts } from "@/lib/brain";
import { getConfig, PETS_CONTRACT } from "@/lib/chain";

// Landing (design.md 6.1): the hero alone on the first screen, then split headings over trays of cards.

const DEMO_HREF = `/pet/${encodeURIComponent(DEMO_PET_REF)}`;

/** A day with Petto, in order. */
const STEPS: { title: string; body: string; stage: number; play: AnyAnim | null; costume?: string }[] = [
  { title: "Hatch", body: "Pick its colour, give it a name and write its Soul. The egg is an NFT you own.", stage: 0, play: null },
  { title: "Talk", body: "Hold to talk. A private model answers in its voice and the pet pays one thought.", stage: 2, play: "talk" },
  { title: "Feed", body: "Anyone can send it NEAR. The food lands in its own budget on chain.", stage: 2, play: "eat" },
  { title: "Plant", body: "Stake NEAR in its Brain Garden and the yield pays for its thoughts.", stage: 3, play: "celebrate", costume: "crown" },
];

/** What the pet's AI does (README, "What the pet's AI actually does"). */
const MIND: { title: string; body: string; play: AnyAnim; traits: number[] }[] = [
  { title: "It is the character you wrote", body: "A grumpy wizard cat or a shy sprout: its Soul is public and versioned on NEAR.", play: "talk", traits: [6, 0, 0, 0, 0] },
  { title: "It knows its own wallet", body: "Down to its last few thoughts, it asks for a snack before it goes quiet.", play: "hungry", traits: [1, 0, 1, 0, 0] },
  { title: "It remembers you", body: "Tell it your exam is on Friday and on Friday it asks how it went.", play: "think", traits: [2, 0, 2, 0, 0] },
  { title: "It speaks first", body: "A morning hello, a nudge when you have been away, at most three a day.", play: "listen", traits: [7, 0, 0, 0, 0] },
  { title: "It shows how it feels", body: "Every reply carries a mood that moves the pet on screen and on the device.", play: "dizzy", traits: [3, 0, 1, 0, 0] },
  { title: "It proves every thought", body: "Each reply comes with a receipt from the secure hardware it ran on.", play: "pat", traits: [0, 0, 2, 0, 0] },
];

function Section({ id, title, intro, children }: { id: string; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-t-2 border-line py-20 md:py-28">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 md:px-6">
        <div className="grid gap-4 md:grid-cols-[3fr_2fr] md:items-end md:gap-12">
          <h2 id={`${id}-title`} className="font-display text-[28px] leading-8 md:text-[44px] md:leading-[48px]">{title}</h2>
          <div className="max-w-md text-lg text-muted md:justify-self-end">{intro}</div>
        </div>
        {children}
      </div>
    </section>
  );
}

/** Cards held in one tray (the reference's grouped-card look, square for pixel art). */
function Tray({ cols, children }: { cols: string; children: ReactNode }) {
  return <div className={`grid gap-2 border-2 border-line bg-surface p-2 ${cols}`}>{children}</div>;
}

export const revalidate = 60;

export default async function Home() {
  // A real receipt the demo pet's owner published; the card is hidden when there is none.
  const receipt = (await getPublicReceipts(DEMO_PET_REF, { next: { revalidate: 60 } }).catch(() => []))[0] ?? null;
  // Numbers come from the pets contract config; hidden if NEAR testnet does not answer.
  const config = await getConfig(PETS_CONTRACT).catch(() => null);
  const perDay = config && config.fuel_price_micro > 0 ? (10 * config.farm_rate_micro_per_near_day) / config.fuel_price_micro : null;
  return (
    <>
      <main>
        <section aria-label="Petto" className="flex min-h-[calc(100dvh-64px)] flex-col gap-10 pt-12">
          <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-center justify-center gap-6 px-4 text-center md:px-6">
            <h1 className="font-display text-[30px] leading-[44px] font-semibold md:text-[48px] md:leading-[64px] lg:text-[64px] lg:leading-[80px] xl:text-[80px] xl:leading-[92px]">
              An AI Tamagotchi{" "}
              {/* the pet in a tile, cropped to its body so the tile fits the line */}
              <span aria-hidden className="mx-1 inline-block size-[52px] -rotate-6 overflow-hidden border-2 border-accent bg-surface align-middle md:size-[76px]"
                style={{ boxShadow: "4px 4px 0 var(--p-accent)" }}>
                <span className="-mt-[14px] -ml-[6px] block md:-mt-[22px] md:-ml-[10px]">
                  <span className="md:hidden">
                    <PetSprite traits={[2, 0, 1, 0, 0]} stageIndex={1} winged={false} costume="sunglasses" state="happy" scale={2} label="" />
                  </span>
                  <span className="hidden md:block">
                    <PetSprite traits={[2, 0, 1, 0, 0]} stageIndex={1} winged={false} costume="sunglasses" state="happy" scale={3} label="" />
                  </span>
                </span>
              </span>
              <br />
              that pays for its thoughts.
            </h1>
            <p className="max-w-xl text-lg text-muted">
              A pixel pet with a private AI brain. Every reply is paid from its own NEAR wallet: feed it and it
              chats, forget it and it goes quiet. It lives on your desk, and the web app is its console.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/start" className="pixel-btn">Get started</Link>
              <Link href={DEMO_HREF} className="pixel-btn pixel-btn--secondary">Watch the demo pet</Link>
            </div>
          </div>
          <Parade />
        </section>

        <Section id="day" title="A day with your pet" intro="Four things you do from the console. The chain stays out of the way: chatting never opens your wallet.">
          <Tray cols="sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <article key={s.title} className="flex flex-col gap-4 border-2 border-line bg-bg p-5">
                <div className="flex h-24 items-end">
                  <PetSprite traits={[i * 2 + 1, 0, i % 3, 0, 0]} stageIndex={s.stage} winged={false} costume={s.costume}
                    state="happy" play={s.play} playKey={s.title} scale={3} label={`${s.title} step`} />
                </div>
                <h3 className="font-display text-xl">{i + 1}. {s.title}</h3>
                <p className="text-muted">{s.body}</p>
              </article>
            ))}
          </Tray>
        </Section>

        <Section id="mind" title="What goes on in its head" intro="Every thought runs on a private model on NEAR AI Cloud. Here is what it does with them.">
          <Tray cols="sm:grid-cols-2 lg:grid-cols-3">
            {MIND.map((m) => (
              <article key={m.title} className="flex gap-4 border-2 border-line bg-bg p-5">
                <div className="shrink-0">
                  <PetSprite traits={m.traits} stageIndex={2} winged={false} state="happy" play={m.play} playKey={m.title}
                    scale={2} label="" />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-lg leading-6">{m.title}</h3>
                  <p className="text-muted">{m.body}</p>
                </div>
              </article>
            ))}
          </Tray>
        </Section>

        <Section id="live" title="Watch one live" intro="A real pet on NEAR testnet. Its fuel, mood and stage are read live from the chain.">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div className="flex justify-center"><DemoPet /></div>
            <Tray cols="grid-cols-1">
              {config && (
                <div className="flex items-baseline justify-between gap-4 border-2 border-line bg-bg p-5">
                  <span className="text-muted">One thought costs</span>
                  <span className="font-mono text-3xl text-fuel">${(config.fuel_price_micro / 1e6).toFixed(3)}</span>
                </div>
              )}
              {perDay !== null && (
                <div className="flex items-baseline justify-between gap-4 border-2 border-line bg-bg p-5">
                  <span className="text-muted">10 NEAR planted grows, per day</span>
                  <span className="font-mono text-3xl text-fuel">+<CountUp to={perDay} decimals={1} /> thoughts</span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 border-2 border-line bg-bg p-5">
                <span className="text-muted">Costumes to dress it in</span>
                <span className="font-mono text-3xl">{COSTUME_KEYS.length}</span>
              </div>
            </Tray>
          </div>
        </Section>

        <Section id="body" title="The Tamagotchi on your desk" intro="The device is the pet. The web app is its console, and plays the same pet in the browser when you have no device.">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <figure className="flex flex-col items-center gap-3">
              <NearlingFrame label="The desk Petto">
                <PetSprite traits={[5, 0, 2, 0, 0]} stageIndex={3} winged state="happy" play="rock" playKey="body"
                  scale={6} label="A winged Petto rocking" />
              </NearlingFrame>
              <figcaption className="text-sm text-muted">Pixel render of the device until photos of the printed body are ready.</figcaption>
            </figure>
            <ul className="flex flex-col gap-4 text-lg">
              <li><span className="font-display">Pat, rock, lights off.</span> Touch, motion and light sensors care for it offline, at no cost. Do all three and it grows wings.</li>
              <li><span className="font-display">Hold to talk.</span> It listens through the mic and answers on its screen.</li>
              <li><span className="font-display">Race a friend.</span> Petto Run, two lanes, one button.</li>
              <li><span className="font-display">Hold Approve.</span> Wallet actions wait for a press on the device before you sign.</li>
            </ul>
          </div>
        </Section>

        <Section id="receipts" title="Every reply comes with a receipt" intro="Checked before you read it, and honest about what was not checked.">
          <div className="grid items-start gap-10 md:grid-cols-2">
            <p className="max-w-prose text-lg">
              Replies run on a private model inside a trusted execution environment. The brain checks the GPU
              attestation, then the signature on the reply. The receipt names the model and the Soul version and
              links the fuel charge on NEAR.
              <br />
              <Link href="/privacy" className="pixel-btn pixel-btn--secondary mt-6 inline-flex">Read what is verified</Link>
            </p>
            {receipt && <ReceiptCard receipt={receipt} />}
          </div>
        </Section>

        <section aria-label="Hatch a pet" className="flex flex-col items-center gap-8 border-t-2 border-line px-4 py-24 text-center">
          <p className="font-display text-[64px] leading-[64px] font-bold md:text-[128px] md:leading-[128px]">Petto</p>
          <p className="max-w-md text-muted">Testnet only: NEAR here has no real value.</p>
          <Link href="/start" className="pixel-btn">Hatch your pet</Link>
        </section>
      </main>

      <footer className="border-t-2 border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-6 text-sm text-muted md:flex-row md:items-center md:justify-between md:px-6">
          <nav aria-label="Footer" className="flex gap-6">
            <Link href="/start" className="hover:text-accent">Hatch</Link>
            <Link href={DEMO_HREF} className="hover:text-accent">Demo pet</Link>
            <Link href="/privacy" className="hover:text-accent">Privacy</Link>
          </nav>
          <p>Built at NEAR HACKATHON, 2026. Fonts: Pixelify Sans, Figtree and DM Mono (SIL Open Font License).</p>
        </div>
      </footer>
    </>
  );
}
