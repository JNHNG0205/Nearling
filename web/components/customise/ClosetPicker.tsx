"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PetSprite } from "@/components/PetSprite";
import { CostumeGrid } from "@/components/customise/CostumeGrid";
import { equipShirt } from "@/components/wallet/brainApi";
import { ErrorText, Panel, Spinner, TxStatus } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { useTx } from "@/components/wallet/useTx";
import { BrainRequestError } from "@/lib/brain";
import { formatNear, nftTokensForOwner, SHIRT_DEPOSIT, SHIRTS_CONTRACT, tx } from "@/lib/chain";
import { closetItems, costumeLabel, shopCostumes, type ClosetItem } from "@/lib/closet";
import { brainErrorCopy } from "@/lib/errors";

// The Closet: the owner's shirt and costumes (shirts contract NFTs), and the costume shop
// (`buy(costume)`, 0.05 NEAR each). Trying on is local; wearing goes through the brain.
export function Closet({ pet }: { pet: PetData }) {
  const owner = pet.chain!.owner;
  const name = pet.chain!.name;
  const [items, setItems] = useState<ClosetItem[] | null>(null);
  const [equipped, setEquipped] = useState<string | null>(pet.brain?.equipped_shirt ?? null);
  const [trying, setTrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const claimTx = useTx(name);
  const buyTx = useTx(name);
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = closetItems(await nftTokensForOwner(SHIRTS_CONTRACT, owner));
      setItems(next);
      return next;
    } catch {
      setError("Couldn't load the closet from NEAR testnet.");
      return null;
    }
  }, [owner]);

  useEffect(() => {
    void load();
  }, [load]);

  async function wear(tokenId: string | null) {
    setSaving(true);
    setError(null);
    try {
      const r = await equipShirt(pet.ref, tokenId);
      setEquipped(r.equipped);
      setTrying(null);
    } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name));
    } finally {
      setSaving(false);
    }
  }

  async function claim() {
    if (await claimTx.send(tx.claimShirt())) await load();
  }

  async function buy(costume: string) {
    setBuying(costume);
    const r = await buyTx.send(tx.buyCostume(costume));
    if (r) {
      // wear it straight away: the new token is the owner's copy of this costume
      const bought = (await load())?.find((i) => i.costume === costume);
      if (bought) await wear(bought.tokenId);
    }
    setBuying(null);
  }

  const sprite = (item: { tokenId: string | null; costume: string | null }, scale: number, label: string) => (
    <PetSprite traits={pet.chain!.traits} stageIndex={pet.brain?.stage_index ?? pet.chain!.stage}
      winged={pet.brain?.form === "winged"} shirt={item.costume ? null : item.tokenId} costume={item.costume}
      state="happy" scale={scale} label={label} />
  );

  if (!items) return error ? <ErrorText>{error}</ErrorText> : <Spinner />;

  const worn = items.find((i) => i.tokenId === equipped) ?? null;
  const shown = trying ? { tokenId: null, costume: trying } : { tokenId: worn?.tokenId ?? null, costume: worn?.costume ?? null };
  const caption = trying ? `Trying on: ${costumeLabel(trying)}` : worn ? `Wearing: ${worn.title}` : "Nothing on";
  const hasShirt = items.some((i) => i.costume === null);
  const shop = shopCostumes(items);
  const model = {
    name, traits: pet.chain!.traits, stageIndex: pet.brain?.stage_index ?? pet.chain!.stage, winged: pet.brain?.form === "winged",
  };

  return (
    <>
      <Panel>
        <div className="flex flex-col items-center gap-2">
          {sprite(shown, 6, `${name}. ${caption}`)}
          <p className="font-display text-sm text-muted" aria-live="polite">{caption}</p>
          {trying && (
            <button className="text-sm underline" onClick={() => setTrying(null)}>Stop trying on</button>
          )}
        </div>
      </Panel>

      <section aria-labelledby="closet-title" className="flex flex-col gap-3">
        <h2 id="closet-title" className="font-display text-lg">In your closet</h2>
        {items.length === 0 && <p className="text-sm text-muted">Nothing yet. Claim the free shirt or buy a costume below.</p>}
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const on = equipped === item.tokenId;
            return (
              <li key={item.tokenId} className="pixel-panel flex items-center justify-between gap-3 p-4">
                {sprite(item, 2, `${name} in ${item.title}`)}
                <span className="flex flex-1 flex-col">
                  <span className="font-display">{item.title}</span>
                  <span className="font-mono text-sm text-muted">#{item.tokenId}</span>
                </span>
                <button className={`pixel-btn ${on ? "pixel-btn--secondary" : ""}`} disabled={saving}
                  onClick={() => void wear(on ? null : item.tokenId)}>
                  {on ? "Take off" : "Wear"}
                </button>
              </li>
            );
          })}
        </ul>
        {!hasShirt && (
          <Panel>
            <h3 className="font-display">Free Petto shirt</h3>
            <p className="text-sm text-muted">
              One per account, as an NFT. You attach {formatNear(SHIRT_DEPOSIT)} NEAR for its storage.
            </p>
            <button className="pixel-btn self-start" disabled={claimTx.busy} onClick={() => void claim()}>
              {claimTx.busy ? "Check your wallet..." : "Claim a shirt"}
            </button>
            <TxStatus state={claimTx.state} doneText="Claimed" />
          </Panel>
        )}
      </section>

      {shop.length > 0 && (
        <section aria-labelledby="shop-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="shop-title" className="font-display text-lg">Costume shop</h2>
            <Link href={`/shop?pet=${encodeURIComponent(pet.ref)}`} className="font-display text-sm text-accent hover:underline">
              Open the Shop &gt;
            </Link>
          </div>
          <TxStatus state={buyTx.state} doneText="Bought" />
          <CostumeGrid model={model} keys={shop} trying={trying} busyKey={buying} disabled={buyTx.busy || saving}
            onTry={setTrying} onBuy={(key) => void buy(key)} />
        </section>
      )}
      <p className="text-sm text-muted">Changing the shirt on your Petto's buttons shows up here too.</p>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
