import type { Metadata } from "next";
import Link from "next/link";
import { getAttestation, minutesAgo, shortHash, type AttestationSummary } from "@/lib/brain";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Private replies . Nearling",
  description: "How Nearling replies run on private NEAR AI models, what each receipt proves and what it does not.",
};

const VERIFIED = [
  "The model runs on GPUs inside a trusted execution environment. The brain checks NVIDIA's GPU attestation with a fresh nonce at least every 30 minutes.",
  "Each reply is signed inside the TEE. The brain hashes the exact request and response bytes and checks that the signature covers both.",
  "The receipt says which personality (Soul version) and which model made the reply, and links the on-chain fuel charge.",
];

const NOT_VERIFIED = [
  "The Intel TDX CPU quote is not checked in the app.",
  "The brain itself is not in a TEE. It builds the prompt and can read the pet's memories, which are encrypted at rest.",
  "A Gateway verified reply was signed by the NEAR AI gateway, not by the model's own key.",
  "Request and response bytes are dropped after hashing, so a receipt cannot be replayed against the text later.",
];

// Privacy page (04 section 7): latest attestation, what is and is not verified, voice disclosure.
export default async function Privacy() {
  const att: AttestationSummary[] | null = await getAttestation({ next: { revalidate: 300 } }).catch(() => null);
  const now = Date.now();

  return (
    <main className="mx-auto flex min-h-dvh max-w-[720px] flex-col gap-10 px-4 py-8 md:px-6">
      <header className="flex flex-col gap-3">
        <Link href="/" className="font-display text-accent">Nearling</Link>
        <h1 className="font-display text-[32px] leading-9 font-semibold md:text-[40px] md:leading-[44px]">Private replies</h1>
        <p className="text-muted">
          Every Nearling reply runs on a private NEAR AI model and comes with a receipt. This page says what the
          receipt proves and what it does not.
        </p>
      </header>

      <section aria-labelledby="att" className="flex flex-col gap-3">
        <h2 id="att" className="font-display text-2xl">Latest attestation</h2>
        {att === null ? (
          <p className="text-warn"><span aria-hidden>! </span>The brain did not answer, so no attestation is shown right now.</p>
        ) : att.length === 0 ? (
          <p className="text-muted">No attestation fetched yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {att.map((a) => (
              <li key={a.model} className="pixel-panel flex flex-col gap-1 p-3">
                <span className="font-mono">{a.model}</span>
                <span className={a.ok ? "text-fuel" : "text-warn"}>
                  <span aria-hidden>{a.ok ? "✓ " : "! "}</span>
                  {a.ok ? "GPU attestation passed" : a.nras === "pass" ? "GPU attestation passed, a refresh is due" : "GPU attestation not passing"}
                  {a.fetched_at ? `, ${minutesAgo(a.fetched_at, now)}` : ""}
                </span>
                {a.signers.length > 0 && (
                  <span className="font-mono text-sm text-muted">Model signers {a.signers.map(shortHash).join(", ")}</span>
                )}
                {a.gateway_signer && <span className="font-mono text-sm text-muted">Gateway signer {shortHash(a.gateway_signer)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="yes" className="flex flex-col gap-3">
        <h2 id="yes" className="font-display text-2xl">What is checked</h2>
        <ul className="flex flex-col gap-2">
          {VERIFIED.map((t) => <li key={t} className="flex gap-2"><span className="font-mono text-fuel" aria-label="checked">[ok]</span>{t}</li>)}
        </ul>
      </section>

      <section aria-labelledby="no" className="flex flex-col gap-3">
        <h2 id="no" className="font-display text-2xl">What is not checked</h2>
        <ul className="flex flex-col gap-2">
          {NOT_VERIFIED.map((t) => <li key={t} className="flex gap-2"><span className="font-mono text-muted" aria-label="not checked">[--]</span>{t}</li>)}
        </ul>
      </section>

      <section aria-labelledby="voice" className="flex flex-col gap-3">
        <h2 id="voice" className="font-display text-2xl">Voice</h2>
        <p>
          Spoken replies use ElevenLabs, a third-party voice service. When a reply is spoken, its text leaves the
          private model and goes to ElevenLabs to become audio. When you hold to talk, your recording is sent to
          NEAR AI to be turned into text. The text of every reply is always shown, and each receipt says whether voice was used.
        </p>
      </section>

      <section aria-labelledby="chain" className="flex flex-col gap-3">
        <h2 id="chain" className="font-display text-2xl">On chain</h2>
        <p>
          The pet&apos;s fuel, its Soul and every charge are public on NEAR testnet. What you say to your pet is not
          on chain and is never written to logs. A receipt only becomes public if the owner publishes it.
        </p>
      </section>
    </main>
  );
}
