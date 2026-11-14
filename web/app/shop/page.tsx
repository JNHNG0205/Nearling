"use client";

import { COSTUME_KEYS, type CostumeKey } from "@nearling/sprites";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PetSprite } from "@/components/PetSprite";
import { CostumeGrid, type Model } from "@/components/customise/CostumeGrid";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { equipShirt } from "@/components/wallet/brainApi";
import { AppFrame, ErrorText, Panel, Spinner, TxStatus } from "@/components/wallet/ui";
import { useTx } from "@/components/wallet/useTx";
import { BrainRequestError } from "@/lib/brain";
import { COSTUME_PRICE, formatNear, nftTokensForOwner, SHIRTS_CONTRACT, tx } from "@/lib/chain";
import { closetItems, costumeLabel, ownedCostumes, type ClosetItem } from "@/lib/closet";
import { brainErrorCopy } from "@/lib/errors";
import { loadMyPets, type MyPet } from "@/lib/myPets";
import { authHeaders } from "@/lib/session";
import { useSignIn } from "@/lib/wallet";

/** Preview pet for visitors and owners without a pet yet. */
const SAMPLE: Model = { name: "Petto", traits: [2, 0, 1, 0, 0], stageIndex: 2, winged: false };

// /shop: every costume (shirts contract `buy(costume)`), previewed on one of the owner's pets.
// Buying wears it on that pet; costumes already owned can be worn from here. `?pet=<petRef>` picks the pet.
export default function ShopPage() {
  return (
    <Suspense fallback={<AppFrame title="Shop" wide><Spinner /></AppFrame>}>
      <Shop />
    </Suspense>
  );
}

function Shop() {
  const params = useSearchParams();
  const { wallet, session } = useSignIn();
  const account = wallet.accountId;
  const [pets, setPets] = useState<MyPet[]>([]);
  const [petRef, setPetRef] = useState<string | null>(params.get("pet"));
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [worn, setWorn] = useState<Record<string, string | null>>({});
  const [trying, setTrying] = useState<CostumeKey | null>(null);
  const [buying, setBuying] = useState<CostumeKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pet = pets.find((p) => p.ref === petRef && p.state) ?? pets.find((p) => p.state) ?? null;
  const name = pet?.name ?? SAMPLE.name;
  const buyTx = useTx(name);
  const model: Model = pet?.state
    ? { name, traits: pet.state.traits, stageIndex: pet.state.stage_index, winged: pet.state.form === "winged" }
    : SAMPLE;

  const loadItems = useCallback(async () => {
    if (!account) return null;
    try {
      const next = closetItems(await nftTokensForOwner(SHIRTS_CONTRACT, account));
      setItems(next);
      return next;
    } catch {
      setError("Couldn't load your closet from NEAR testnet.");
      return null;
    }
  }, [account]);

  useEffect(() => {
    if (!account) {
      setPets([]);
      setItems([]);
      return;
    }
    let live = true;
    loadMyPets(account, session ? authHeaders() : {})
      .then((r) => {
        if (!live) return;
        setPets(r.pets);
        setWorn(Object.fromEntries(r.pets.map((p) => [p.ref, p.state?.equipped_costume ?? null])));
      })
      .catch(() => live && setError("Couldn't reach NEAR testnet. Retry in a moment."));
    void loadItems();
    return () => {
      live = false;
    };
  }, [account, session, loadItems]);

  async function wear(tokenId: string, costume: CostumeKey) {
    if (!pet) return;
    setSaving(true);
    setError(null);
    try {
      await equipShirt(pet.ref, tokenId);
      setWorn((w) => ({ ...w, [pet.ref]: costume }));
      setTrying(null);
    } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name));
    } finally {
      setSaving(false);
    }
  }

  async function buy(costume: CostumeKey) {
    setBuying(costume);
    if (await buyTx.send(tx.buyCostume(costume))) {
      const token = ownedCostumes((await loadItems()) ?? []).get(costume);
      if (token && pet) await wear(token, costume);
    }
    setBuying(null);
  }

  const owned = ownedCostumes(items);
  const current = trying ?? (pet ? worn[pet.ref] ?? null : null);
  const caption = trying ? `Trying on: ${costumeLabel(trying)}` : current ? `Wearing: ${costumeLabel(current)}` : "Tap a costume to try it on";

  return (
    <AppFrame title="Shop" wide>
      <Panel>
        <div className="flex flex-col items-center gap-2">
          <PetSprite traits={model.traits} stageIndex={model.stageIndex} winged={model.winged} costume={current}
            state="happy" scale={6} label={`${model.name}. ${caption}`} />
          <p className="font-display text-sm text-muted" aria-live="polite">{caption}</p>
          {pets.length > 1 && (
            <label className="flex items-center gap-2 text-sm">Dress up
              <select className="bg-surface px-2 py-1" value={pet?.ref ?? ""}
                onChange={(e) => { setPetRef(e.target.value); setTrying(null); }}>
                {pets.filter((p) => p.state).map((p) => <option key={p.ref} value={p.ref}>{p.name}</option>)}
              </select>
            </label>
          )}
          {!account && (
            <>
              <p className="text-sm text-muted">Connect your wallet to buy costumes and dress up your pets.</p>
              <ConnectButton />
            </>
          )}
          {account && !pet && <p className="text-sm text-muted">No pet yet: costumes you buy wait in your closet.</p>}
        </div>
      </Panel>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg">Costumes</h2>
        <span className="text-sm text-muted">{formatNear(COSTUME_PRICE)} NEAR each, yours to keep as an NFT</span>
      </div>
      <TxStatus state={buyTx.state} doneText="Bought" />
      <ErrorText>{error}</ErrorText>
      <CostumeGrid model={model} keys={COSTUME_KEYS} owned={owned} trying={trying} busyKey={buying}
        disabled={buyTx.busy || saving} onTry={setTrying}
        onBuy={account ? (key) => void buy(key) : null}
        onWear={pet ? (tokenId) => {
          const key = [...owned].find(([, t]) => t === tokenId)?.[0];
          if (key) void wear(tokenId, key);
        } : undefined} />
    </AppFrame>
  );
}
