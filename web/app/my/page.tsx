"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FuelMeter } from "@/components/FuelMeter";
import { PetSprite } from "@/components/PetSprite";
import { DemoSpeedPill, StatePill } from "@/components/nearling/Pills";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { AppFrame, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import { getInbox } from "@/lib/brain";
import { accountBalance, formatNear, petPath } from "@/lib/chain";
import { moveplan, type OldPet } from "@/lib/nearName";
import { moveFromOldAccount, privyAccounts } from "@/lib/privyHost";
import { deviceNudgeKey, needsYou, type HomePet } from "@/lib/flow";
import { loadMyPets, myPetsFromChain, type MyPet } from "@/lib/myPets";
import { authHeaders } from "@/lib/session";
import { useSignIn } from "@/lib/wallet";

// /my, the app's Home (W11): what needs the owner, then a card per pet with quick actions.
// Pets from the brain's `GET /me/pets`, chain fallback; unread messages from each pet's inbox.
export default function HomePage() {
  const { wallet, session } = useSignIn();
  const account = wallet.accountId;
  const [pets, setPets] = useState<MyPet[] | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    let live = true;
    setPets(null);
    setError(null);
    loadMyPets(account, session ? authHeaders() : {})
      .then((r) => {
        if (!live) return;
        setPets(r.pets);
        if (!session) return;
        // unread counts are owner-only and best effort: a pet whose inbox fails shows none
        void Promise.all(
          r.pets.map(async (p) => [p.ref, (await getInbox(p.ref, authHeaders()).catch(() => [])).filter((i) => i.read_at === null).length] as const),
        ).then((counts) => live && setUnread(Object.fromEntries(counts)));
      })
      .catch(() => live && setError("Couldn't reach NEAR testnet. Retry in a moment."));
    return () => {
      live = false;
    };
  }, [account, session]);

  const needs = useMemo(() => {
    if (!pets) return [];
    const home: HomePet[] = pets.flatMap((p) =>
      p.state
        ? [{
            contract: p.contract, tokenId: p.tokenId, name: p.name, fuelLeft: p.state.fuel.left, fuelLow: p.state.fuel.low,
            hatched: p.state.hatched, unread: unread[p.ref] ?? 0, paired: p.state.device.paired,
          }]
        : [],
    );
    const dismissed = new Set(pets.map((p) => p.ref).filter((ref) => readFlag(deviceNudgeKey(ref))));
    return needsYou(home, dismissed);
  }, [pets, unread]);

  if (!wallet.ready) {
    return (
      <AppFrame title="Home">
        <Spinner />
      </AppFrame>
    );
  }
  if (!account) {
    return (
      <AppFrame title="Home">
        <Panel>
          <p>Connect your wallet to see your pets.</p>
          <ConnectButton />
        </Panel>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Home" wide>
      <OldAccountBanner account={account} />
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : pets === null ? (
        <Spinner label="Finding your pets..." />
      ) : pets.length === 0 ? (
        <Panel>
          <p>No pets yet. Setup hatches your first one and connects your Petto.</p>
          <Link href="/start" className="pixel-btn self-start">Hatch your first pet</Link>
        </Panel>
      ) : (
        <>
          <section aria-labelledby="needs-title" className="flex flex-col gap-2">
            <h2 id="needs-title" className="font-display text-lg">Needs you</h2>
            {needs.length === 0 ? (
              <p className="text-sm text-muted">All your pets are fine right now.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {needs.map((n) => (
                  <li key={n.key}>
                    <Link href={n.href}
                      className={`flex items-center justify-between gap-3 border-2 px-3 py-2 text-sm hover:border-accent ${n.urgent ? "border-danger" : "border-line"}`}>
                      <span>{n.text}</span>
                      <span aria-hidden className="font-display text-accent">&gt;</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="pets-title" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="pets-title" className="font-display text-lg">Your pets</h2>
              <Link href="/adopt" className="pixel-btn">Hatch a new pet</Link>
            </div>
            <ul className="grid gap-3 md:grid-cols-2">
              {pets.map((p) => (
                <li key={p.ref}>
                  <PetCard pet={p} unread={unread[p.ref] ?? 0} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </AppFrame>
  );
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function PetCard({ pet, unread }: { pet: MyPet; unread: number }) {
  const s = pet.state;
  const home = petPath(pet.contract, pet.tokenId);
  return (
    <article className="pixel-panel flex h-full flex-col gap-3 p-3">
      <Link href={home} className="flex items-center gap-4">
        {s && (
          <PetSprite traits={s.traits} stageIndex={s.stage_index} winged={s.form === "winged"} shirt={s.equipped_shirt}
            state={s.display_state} scale={2} label={s.name} />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="font-display text-lg">{pet.name}</span>
          <span className="flex flex-wrap gap-2">
            {pet.demo && <DemoSpeedPill />}
            {s && <StatePill state={s.display_state} />}
          </span>
        </span>
      </Link>
      {s ? <FuelMeter fuel={s.fuel} name={s.name} /> : <span className="text-sm text-muted">The brain has no state for this pet yet.</span>}
      {s && (
        <p className="text-sm text-muted">
          {unread > 0 ? `${unread} new ${unread === 1 ? "message" : "messages"} · ` : ""}
          {s.device.paired ? "Petto connected" : (
            <Link href={petPath(pet.contract, pet.tokenId, "/device")} className="underline">No device · Connect</Link>
          )}
        </p>
      )}
      <div className="mt-auto flex gap-2">
        <Link href={home} className="pixel-btn flex-1 text-center text-sm">Talk</Link>
        <Link href={`/feed/${encodeURIComponent(pet.ref)}`} className="pixel-btn pixel-btn--secondary flex-1 text-center text-sm">Feed</Link>
      </div>
    </article>
  );
}

/**
 * Email/Google users who got a NEAR name: their old hex account may still hold pets and NEAR.
 * Moves the pets with nothing planted and the NEAR above a small reserve (lib/nearName.ts).
 */
function OldAccountBanner({ account }: { account: string }) {
  const [old, setOld] = useState<{ implicit: string; move: OldPet[]; keep: OldPet[]; near: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const ids = await privyAccounts();
      if (!ids || ids.active === ids.implicit || ids.active !== account) return;
      const [pets, balance] = await Promise.all([myPetsFromChain(ids.implicit), accountBalance(ids.implicit)]);
      const oldPets: OldPet[] = pets.map((p) => ({
        contract: p.contract,
        tokenId: p.tokenId,
        name: p.name,
        staked: p.state?.garden.staked_yocto ?? "1", // unknown: keep it where it is
        pending: !!p.state?.garden.pending_unstake,
      }));
      const plan = moveplan(oldPets, balance);
      if (live && (plan.move.length > 0 || plan.nearYocto > 0n)) setOld({ implicit: ids.implicit, ...plan, near: plan.nearYocto });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [account]);

  if (!old) return null;
  const what = [
    old.move.length > 0 ? `${old.move.length} ${old.move.length === 1 ? "pet" : "pets"} (${old.move.map((p) => p.name).join(", ")})` : null,
    old.near > 0n ? `${formatNear(old.near, 3)} NEAR` : null,
  ].filter(Boolean).join(" and ");

  async function move() {
    setBusy(true);
    setError(null);
    try {
      await moveFromOldAccount(old!.move, old!.near);
      window.location.reload();
    } catch {
      setError("The move stopped part way. What moved stays moved; try again for the rest.");
      setBusy(false);
    }
  }

  return (
    <section aria-label="Move from your old account" className="pixel-panel flex flex-col gap-3 border-accent p-4">
      <p className="text-sm">
        Your old account still holds {what}. Move {old.move.length + (old.near > 0n ? 1 : 0) > 1 ? "them" : "it"} to{" "}
        <span className="font-mono">{account}</span>?
      </p>
      {old.keep.length > 0 && (
        <p className="text-xs text-muted">
          {old.keep.map((p) => p.name).join(", ")} stay for now: take the NEAR out of the Brain Garden first.
        </p>
      )}
      <button className="pixel-btn self-start" disabled={busy} onClick={() => void move()}>
        {busy ? "Moving..." : `Move to ${account}`}
      </button>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
