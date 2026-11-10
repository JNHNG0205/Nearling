"use client";

import { useState } from "react";
import { unpair } from "@/components/wallet/brainApi";
import { OwnerGate } from "@/components/wallet/OwnerGate";
import { PetHeader } from "@/components/wallet/PetHeader";
import { PetPage } from "@/components/wallet/PetPage";
import { ErrorText, Panel } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { BrainRequestError } from "@/lib/brain";
import { brainErrorCopy } from "@/lib/errors";

// /pet/[petRef]/device (01 route map): pairing status and unpair. Pairing itself starts on the device.
export default function DevicePage() {
  return (
    <PetPage title={(n) => `${n}'s Nearling`}>
      {(pet) => (
        <>
          <PetHeader pet={pet} />
          <OwnerGate owner={pet.chain!.owner} name={pet.chain!.name}>
            <Device pet={pet} />
          </OwnerGate>
        </>
      )}
    </PetPage>
  );
}

function Device({ pet }: { pet: PetData }) {
  const name = pet.chain!.name;
  const device = pet.brain?.device;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doUnpair() {
    setBusy(true);
    setError(null);
    try {
      await unpair(pet.ref);
      setConfirm(false);
      await pet.reload();
    } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name));
    } finally {
      setBusy(false);
    }
  }

  if (!device) return <ErrorText>Couldn't reach the brain to check the device. Retry in a moment.</ErrorText>;

  return (
    <>
      <Panel>
        <h2 className="font-display text-lg">{device.paired ? "Paired" : "No Nearling paired"}</h2>
        {device.paired ? (
          <p className="text-sm text-muted">
            {device.last_seen_at ? `Last seen ${new Date(device.last_seen_at).toLocaleString()}.` : "Not seen online yet."}
          </p>
        ) : (
          <p className="text-sm text-muted">
            To pair, turn on your Nearling and scan the QR code on its screen with this phone. Pick {name} when asked.
          </p>
        )}
      </Panel>

      {device.paired && (
        <Panel>
          <h2 className="font-display text-lg">Unpair</h2>
          <p className="text-sm text-muted">
            The Nearling forgets {name} and shows a new pairing code. {name}, its fuel and its Soul stay on NEAR.
          </p>
          {confirm ? (
            <div className="flex gap-3">
              <button className="pixel-btn" disabled={busy} onClick={() => void doUnpair()}>
                {busy ? "Unpairing..." : `Unpair ${name}`}
              </button>
              <button className="pixel-btn pixel-btn--secondary" onClick={() => setConfirm(false)}>
                Keep it paired
              </button>
            </div>
          ) : (
            <button className="pixel-btn pixel-btn--secondary" onClick={() => setConfirm(true)}>
              Unpair this Nearling
            </button>
          )}
        </Panel>
      )}
      <ErrorText>{error}</ErrorText>
    </>
  );
}
