"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FuelMeter } from "@/components/FuelMeter";
import { PetSprite } from "@/components/PetSprite";
import { DemoSpeedPill, StatePill } from "@/components/nearling/Pills";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { AppFrame, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import { petPath } from "@/lib/chain";
import { loadMyPets, type MyPet } from "@/lib/myPets";
import { authHeaders } from "@/lib/session";
import { useSignIn } from "@/lib/wallet";

// /my (W11): the connected owner's pets on both contracts. Brain `GET /me/pets`, chain fallback.
export default function MyPetsPage() {
  const { wallet, session } = useSignIn();
  const account = wallet.accountId;
  const [pets, setPets] = useState<MyPet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    let live = true;
    setPets(null);
    setError(null);
    loadMyPets(account, session ? authHeaders() : {})
      .then((r) => live && setPets(r.pets))
      .catch(() => live && setError("Couldn't reach NEAR testnet. Retry in a moment."));
    return () => {
      live = false;
    };
  }, [account, session]);

  if (!wallet.ready) {
    return (
      <AppFrame title="My pets">
        <Spinner />
      </AppFrame>
    );
  }
  if (!account) {
    return (
      <AppFrame title="My pets">
        <Panel>
          <p>Connect your wallet to see your pets.</p>
          <ConnectButton />
        </Panel>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="My pets">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Pets owned by <span className="font-mono">{account}</span> on NEAR testnet.
        </p>
        {pets && pets.length > 0 && <Link href="/adopt" className="pixel-btn">Hatch a new pet</Link>}
      </div>
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : pets === null ? (
        <Spinner />
      ) : pets.length === 0 ? (
        <Panel>
          <p>No pets yet. Setup hatches your first one and connects your Petto.</p>
          <Link href="/start" className="pixel-btn self-start">Hatch your first pet</Link>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {pets.map((p) => (
            <li key={p.ref} className="flex flex-col gap-1">
              <PetCard pet={p} />
              {p.state && !p.state.device.paired && (
                <Link href={petPath(p.contract, p.tokenId, "/device")} className="self-start text-sm text-muted underline">
                  No device · Connect a Petto
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppFrame>
  );
}

function PetCard({ pet }: { pet: MyPet }) {
  const s = pet.state;
  return (
    <Link href={petPath(pet.contract, pet.tokenId)} className="pixel-panel flex items-center gap-4 p-3">
      {s && (
        <PetSprite traits={s.traits} stageIndex={s.stage_index} winged={s.form === "winged"} state={s.display_state}
          scale={2} label={s.name} />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-display text-lg">{pet.name}</span>
        <span className="flex flex-wrap gap-2">
          {pet.demo && <DemoSpeedPill />}
          {s && <StatePill state={s.display_state} />}
        </span>
        {s ? <FuelMeter fuel={s.fuel} name={s.name} /> : <span className="text-sm text-muted">The brain has no state for this pet yet.</span>}
      </span>
    </Link>
  );
}
