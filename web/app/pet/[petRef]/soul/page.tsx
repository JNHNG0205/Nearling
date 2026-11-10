"use client";

import { useCallback, useEffect, useState } from "react";
import type { SoulView } from "@nearling/shared";
import { getTimeline, toMs, type TimelineItem } from "@/components/wallet/brainApi";
import { SoulField } from "@/components/wallet/MintForm";
import { OwnerGate } from "@/components/wallet/OwnerGate";
import { PetPage } from "@/components/wallet/PetPage";
import { ErrorText, Panel, Spinner, TxLink, TxStatus } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { useTx } from "@/components/wallet/useTx";
import { eventData, getSoul, soulBytes, SOUL_MAX_BYTES, tx } from "@/lib/chain";

// /pet/[petRef]/soul (03 section 7): the public, versioned personality prompt on chain.
export default function SoulPage() {
  return <PetPage title={(n) => `${n}'s Soul`}>{(pet) => <Soul pet={pet} />}</PetPage>;
}

function Soul({ pet }: { pet: PetData }) {
  const name = pet.chain!.name;
  const [soul, setSoul] = useState<SoulView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TimelineItem[] | null>(null);
  const { send, state, busy } = useTx(name);

  const load = useCallback(async () => {
    try {
      const s = await getSoul(pet.contract, pet.tokenId);
      setSoul(s);
      setDraft(s.prompt);
    } catch {
      setError("Couldn't read the Soul from NEAR testnet.");
    }
    getTimeline(pet.ref)
      .then((items) => setHistory(items.filter((i) => i.kind === "soul_updated")))
      .catch(() => setHistory([]));
  }, [pet.contract, pet.tokenId, pet.ref]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const r = await send(tx.setSoul(pet.contract, pet.tokenId, draft.trim()));
    if (!r) return;
    const v = eventData<{ version?: number }>(r.events, "soul_updated")[0]?.version;
    if (v !== undefined) setSoul({ version: v, prompt: draft.trim() });
    else await load();
  }

  if (!soul) return error ? <ErrorText>{error}</ErrorText> : <Spinner />;
  const changed = draft.trim() !== soul.prompt && draft.trim().length > 0;
  const fits = soulBytes(draft.trim()) <= SOUL_MAX_BYTES;

  return (
    <>
      <Panel>
        <h2 className="font-display text-lg">
          {soul.version === 0 ? "No Soul yet" : `Version ${soul.version}`}
        </h2>
        {soul.version === 0 ? (
          <p className="text-sm text-muted">{name} uses the default Nearling personality until you write a Soul.</p>
        ) : (
          <p className="whitespace-pre-wrap">{soul.prompt}</p>
        )}
        <p className="text-sm text-muted">Every reply's receipt shows the Soul version it used.</p>
      </Panel>

      <OwnerGate owner={pet.chain!.owner} name={name} needSession={false}>
        <Panel>
          <h2 className="font-display text-lg">Edit the Soul</h2>
          <SoulField value={draft} onChange={setDraft} />
          <button className="pixel-btn" disabled={!changed || !fits || busy} onClick={() => void save()}>
            {busy ? "Check your wallet..." : `Save version ${soul.version + 1}`}
          </button>
          <TxStatus state={state} doneText="Saved" />
        </Panel>
      </OwnerGate>

      <Panel>
        <h2 className="font-display text-lg">History</h2>
        <p className="text-sm text-muted">
          Only the current Soul is stored. Every change is a public event on NEAR, so the full history stays
          readable.
        </p>
        {history === null ? (
          <Spinner />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">No changes recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {history.map((h, i) => {
              const version = h.version ?? h.raw?.version;
              const at = toMs(h.block_ts ?? null);
              return (
                <li key={h.tx_hash ?? i} className="border-l-2 border-line pl-3">
                  <p className="font-mono text-sm">
                    v{version ?? "?"} {at ? `. ${new Date(at).toLocaleString()}` : ""} {h.tx_hash && <TxLink hash={h.tx_hash} />}
                  </p>
                  {h.raw?.prompt && <p className="whitespace-pre-wrap text-sm text-muted">{h.raw.prompt}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
  );
}
