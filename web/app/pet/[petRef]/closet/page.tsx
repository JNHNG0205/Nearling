"use client";

import { useCallback, useEffect, useState } from "react";
import { equipShirt } from "@/components/wallet/brainApi";
import { OwnerGate } from "@/components/wallet/OwnerGate";
import { PetHeader } from "@/components/wallet/PetHeader";
import { PetPage } from "@/components/wallet/PetPage";
import { ErrorText, Panel, Spinner, TxStatus } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { useTx } from "@/components/wallet/useTx";
import { BrainRequestError } from "@/lib/brain";
import { formatNear, nftTokensForOwner, SHIRT_DEPOSIT, SHIRTS_CONTRACT, tx, type NftToken } from "@/lib/chain";
import { brainErrorCopy } from "@/lib/errors";

// /pet/[petRef]/closet (03 section 6, Build Spec 5).
export default function ClosetPage() {
  return (
    <PetPage title={(n) => `${n}'s closet`}>
      {(pet) => (
        <>
          <PetHeader pet={pet} />
          <OwnerGate owner={pet.chain!.owner} name={pet.chain!.name}>
            <Closet pet={pet} />
          </OwnerGate>
        </>
      )}
    </PetPage>
  );
}

function Closet({ pet }: { pet: PetData }) {
  const owner = pet.chain!.owner;
  const name = pet.chain!.name;
  const [shirts, setShirts] = useState<NftToken[] | null>(null);
  const [equipped, setEquipped] = useState<string | null>(pet.brain?.equipped_shirt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { send, state, busy } = useTx(name);

  const load = useCallback(async () => {
    try {
      setShirts(await nftTokensForOwner(SHIRTS_CONTRACT, owner));
    } catch {
      setError("Couldn't load shirts from NEAR testnet.");
    }
  }, [owner]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim() {
    const r = await send(tx.claimShirt());
    if (r) await load();
  }

  async function wear(tokenId: string | null) {
    setSaving(true);
    setError(null);
    try {
      const r = await equipShirt(pet.ref, tokenId);
      setEquipped(r.equipped);
    } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name));
    } finally {
      setSaving(false);
    }
  }

  if (!shirts) return error ? <ErrorText>{error}</ErrorText> : <Spinner />;

  return (
    <>
      {shirts.length === 0 ? (
        <Panel>
          <h2 className="font-display text-lg">Claim your free shirt</h2>
          <p className="text-sm text-muted">
            One Nearling shirt per account, as an NFT. You attach {formatNear(SHIRT_DEPOSIT)} NEAR for its storage.
          </p>
          <button className="pixel-btn" disabled={busy} onClick={() => void claim()}>
            {busy ? "Check your wallet..." : "Claim a shirt"}
          </button>
          <TxStatus state={state} doneText="Claimed" />
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {shirts.map((s) => {
            const on = equipped === s.token_id;
            return (
              <li key={s.token_id} className="pixel-panel flex items-center justify-between gap-3 p-4">
                <span className="flex flex-col">
                  <span className="font-display">{s.metadata?.title || "Nearling Shirt"}</span>
                  <span className="font-mono text-sm text-muted">#{s.token_id}</span>
                </span>
                <button
                  className={`pixel-btn ${on ? "pixel-btn--secondary" : ""}`}
                  disabled={saving}
                  onClick={() => void wear(on ? null : s.token_id)}
                >
                  {on ? "Take off" : `Put it on ${name}`}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-muted">Changing the shirt on your Nearling's buttons shows up here too.</p>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
