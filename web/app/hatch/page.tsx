"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { formatPetRef } from "@nearling/shared";
import { claimPairing, getPairing } from "@/components/wallet/brainApi";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { HatchAnimation } from "@/components/wallet/HatchAnimation";
import { MintForm } from "@/components/wallet/MintForm";
import { AppFrame, DemoSpeedPill, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import { BrainRequestError } from "@/lib/brain";
import { isDemoContract, nftTokensForOwner, PET_CONTRACTS, PETS_CONTRACT, petFromRef, petPath } from "@/lib/chain";
import { brainErrorCopy } from "@/lib/errors";
import { useSignIn } from "@/lib/wallet";

// /hatch?t=<token> Hatch & Pair (03 section 1, Build Spec 1).

const DEFAULT_SOUL =
  "A small, curious desk pet who loves learning about its owner's day, tells gentle jokes and gets sleepy at night.";
const EXPIRED = "This code has expired. Restart pairing on your Nearling.";
const claimKey = (t: string) => `nearling.pairing.${t}`;

type Phase =
  | { k: "checking" }
  | { k: "invalid"; message: string }
  | { k: "ready" } // connect, then choose
  | { k: "minting" }
  | { k: "claiming"; petRef: string }
  | { k: "waiting"; petRef: string }
  | { k: "paired"; petRef: string };

interface OwnedPet {
  contract: string;
  tokenId: string;
  title: string;
}

export default function HatchPage() {
  return (
    <Suspense fallback={<AppFrame title="Hatch & Pair"><Spinner /></AppFrame>}>
      <Hatch />
    </Suspense>
  );
}

function Hatch() {
  const router = useRouter();
  const token = useSearchParams().get("t") ?? "";
  const { session, wallet } = useSignIn();
  const [phase, setPhase] = useState<Phase>({ k: "checking" });
  const [error, setError] = useState<string | null>(null);

  // 1. check the token
  useEffect(() => {
    if (!token) {
      setPhase({ k: "invalid", message: "Scan the QR code on your Nearling to start." });
      return;
    }
    getPairing(token)
      .then((p) => {
        const mine = typeof window !== "undefined" ? window.sessionStorage.getItem(claimKey(token)) : null;
        if (p.status === "open") setPhase({ k: "ready" });
        else if ((p.status === "awaiting_confirm" || p.status === "claimed") && mine) setPhase({ k: "waiting", petRef: mine });
        else if (p.status === "confirmed" && mine) setPhase({ k: "paired", petRef: mine });
        else setPhase({ k: "invalid", message: EXPIRED });
      })
      .catch((err) =>
        setPhase({
          k: "invalid",
          message: err instanceof BrainRequestError && err.status === 404 ? EXPIRED : brainErrorCopy("upstream", "Your Nearling"),
        }),
      );
  }, [token]);

  // 3. claim the token for a pet
  const claim = useCallback(
    async (petRef: string) => {
      setError(null);
      setPhase({ k: "claiming", petRef });
      try {
        await claimPairing(token, petRef);
        window.sessionStorage.setItem(claimKey(token), petRef);
        setPhase({ k: "waiting", petRef });
      } catch (err) {
        const code = err instanceof BrainRequestError ? err.code : "upstream";
        if (code === "expired" || code === "conflict") setPhase({ k: "invalid", message: EXPIRED });
        else {
          setError(brainErrorCopy(code));
          setPhase({ k: "ready" });
        }
      }
    },
    [token],
  );

  // 4. wait for the button press on the device
  useEffect(() => {
    if (phase.k !== "waiting") return;
    const petRef = phase.petRef;
    const id = window.setInterval(() => {
      getPairing(token)
        .then((p) => {
          if (p.status === "confirmed") setPhase({ k: "paired", petRef });
          else if (p.status === "expired" || p.status === "cancelled") setPhase({ k: "invalid", message: EXPIRED });
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(id);
  }, [phase, token]);

  switch (phase.k) {
    case "checking":
      return (
        <AppFrame title="Hatch & Pair">
          <Spinner label="Looking for your Nearling..." />
        </AppFrame>
      );
    case "invalid":
      return (
        <AppFrame title="Hatch & Pair">
          <Panel>
            <p>{phase.message}</p>
            <Link href="/adopt" className="text-sm text-accent underline">
              Hatch a pet in the browser instead
            </Link>
          </Panel>
        </AppFrame>
      );
    case "claiming":
      return (
        <AppFrame title="Hatch & Pair">
          <Spinner label="Linking your pet..." />
        </AppFrame>
      );
    case "waiting":
      return (
        <AppFrame title="Almost there">
          <Panel>
            <p className="font-display text-lg">Press the button on your Nearling</p>
            <p className="text-sm text-muted">Your Nearling asks to pair. Press its button to say yes.</p>
            <Spinner label="Waiting for your Nearling..." />
          </Panel>
        </AppFrame>
      );
    case "paired": {
      const p = petFromRef(phase.petRef);
      return (
        <AppFrame title="Paired">
          {p ? (
            <HatchAnimation contract={p.contract} tokenId={p.tokenId} onDone={() => router.push(petPath(p.contract, p.tokenId))} />
          ) : (
            <p>Your Nearling is paired.</p>
          )}
        </AppFrame>
      );
    }
    case "minting":
      return (
        <AppFrame title="Hatch your pet">
          <Panel>
            <MintForm
              contract={PETS_CONTRACT}
              defaultSoul={DEFAULT_SOUL}
              onMinted={(id) => void claim(formatPetRef(PETS_CONTRACT, id))}
            />
            <button className="self-start text-sm text-muted underline" onClick={() => setPhase({ k: "ready" })}>
              Pick an existing pet instead
            </button>
          </Panel>
        </AppFrame>
      );
    case "ready":
      return (
        <AppFrame title="Nearling found">
          <Panel>
            <p>Connect your wallet to hatch a pet or pair one you already have.</p>
            <ConnectButton />
          </Panel>
          {session && wallet.accountId && (
            <>
              <button className="pixel-btn" onClick={() => setPhase({ k: "minting" })}>
                Hatch a new pet
              </button>
              <MyPets accountId={wallet.accountId} onPick={(p) => void claim(formatPetRef(p.contract, p.tokenId))} />
            </>
          )}
          <ErrorText>{error}</ErrorText>
        </AppFrame>
      );
  }
}

function MyPets({ accountId, onPick }: { accountId: string; onPick: (p: OwnedPet) => void }) {
  const [pets, setPets] = useState<OwnedPet[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all(
      PET_CONTRACTS.map((c) =>
        nftTokensForOwner(c, accountId).then((ts) =>
          ts.map((t) => ({ contract: c, tokenId: t.token_id, title: t.metadata?.title || `Pet #${t.token_id}` })),
        ),
      ),
    )
      .then((all) => live && setPets(all.flat()))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [accountId]);

  if (failed) return <ErrorText>Couldn't load your pets from NEAR testnet.</ErrorText>;
  if (!pets) return <Spinner />;
  if (pets.length === 0) return <p className="text-sm text-muted">No pets yet. Hatch one.</p>;
  return (
    <Panel>
      <h2 className="font-display text-lg">Or pair a pet you have</h2>
      <ul className="flex flex-col gap-2">
        {pets.map((p) => (
          <li key={`${p.contract}:${p.tokenId}`}>
            <button className="pixel-btn pixel-btn--secondary w-full justify-between gap-2" onClick={() => onPick(p)}>
              <span>Pair {p.title}</span>
              {isDemoContract(p.contract) && <DemoSpeedPill />}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
