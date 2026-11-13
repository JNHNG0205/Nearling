"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  createOrder,
  getPacks,
  reportDirectTx,
  type Pack,
  type PacksResponse,
  type PayMode,
} from "@/components/wallet/brainApi";
import { PantryCard } from "@/components/garden/PantryCard";
import { FaucetPanel } from "@/components/wallet/FaucetPanel";
import { PetHeader } from "@/components/wallet/PetHeader";
import { PetPage } from "@/components/wallet/PetPage";
import { ErrorText, Panel, TxStatus } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { useTx } from "@/components/wallet/useTx";
import { BrainRequestError } from "@/lib/brain";
import { eventData, formatNear, tx } from "@/lib/chain";
import { withGas } from "@/lib/faucet";
import { brainErrorCopy, CANCELLED, isWalletRejection } from "@/lib/errors";
import { useWallet } from "@/lib/wallet";

// /feed/[petRef] Feed the Brain (03 section 4, Build Spec 3). Anyone can feed.
export default function FeedPage() {
  return <PetPage title={(n) => `Feed ${n}`}>{(pet) => <Feed pet={pet} />}</PetPage>;
}

const MODE_LABEL: Record<PayMode, string> = {
  direct: "NEAR wallet",
  live: "Other chain",
};

function Feed({ pet }: { pet: PetData }) {
  const router = useRouter();
  const wallet = useWallet();
  const name = pet.chain!.name;
  const [packs, setPacks] = useState<PacksResponse | null>(null);
  const [brainDown, setBrainDown] = useState(false);
  const [packId, setPackId] = useState<string>("meal");
  const [mode, setMode] = useState<PayMode>("direct");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fedHere, setFedHere] = useState<number | null>(null);
  const { send, state } = useTx(name);

  useEffect(() => {
    getPacks()
      .then(setPacks)
      // no made-up packs: prices and fuel come only from the brain
      .catch(() => setBrainDown(true));
  }, []);

  if (!packs && brainDown) {
    return (
      <p role="alert" className="text-sm text-danger">
        {"Feed packs could not load from Petto's brain. Check your connection and refresh the page."}
      </p>
    );
  }
  if (!packs) return <p className="font-mono text-sm text-muted">Loading packs...</p>;
  if (packs.packs.length === 0) return <p className="text-sm text-muted">No feed packs are on sale right now.</p>;
  // live mode stays hidden unless the brain enables it (each live payment needs human approval)
  const modes = packs.modes.filter((m) => m === "direct" || m === "live");
  const activeMode = modes.includes(mode) ? mode : modes[0] ?? "direct";
  const pack: Pack = packs.packs.find((p) => p.id === packId) ?? packs.packs[0]!;

  async function payDirect() {
    setBusy(true);
    setError(null);
    try {
      if (!wallet.accountId) await wallet.connect();
      let orderId: string | null = null;
      if (!brainDown) {
        try {
          orderId = (await createOrder(pet.ref, pack.id, "direct")).id;
        } catch {
          orderId = null; // brain unreachable: still feed on chain, the fuel is real
        }
      }
      const r = await send(tx.feed(pet.contract, pet.tokenId, BigInt(pack.feed_yocto)));
      if (!r) return;
      if (orderId && r.hash) {
        await reportDirectTx(orderId, r.hash).catch(() => undefined);
        router.push(`/order/${encodeURIComponent(orderId)}`);
        return;
      }
      if (eventData(r.events, "fed").length) {
        setFedHere(pack.fuel);
        void pet.reload();
      }
    } catch (err) {
      setError(isWalletRejection(err) ? CANCELLED : brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name));
    } finally {
      setBusy(false);
    }
  }

  async function payOther(m: "live") {
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder(pet.ref, pack.id, m);
      router.push(`/order/${encodeURIComponent(order.id)}`);
    } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PetHeader pet={pet} />
      {activeMode === "direct" && <FaucetPanel need={withGas(pack.feed_yocto)} />}
      <Panel>
        <h2 className="font-display text-lg">Pick a pack</h2>
        <div className="grid grid-cols-3 gap-2">
          {packs.packs.map((p) => (
            <button
              key={p.id}
              onClick={() => setPackId(p.id)}
              aria-pressed={p.id === pack.id}
              className={`flex flex-col items-center gap-1 border-2 p-3 ${p.id === pack.id ? "border-accent" : "border-line"}`}
            >
              <span className="font-display">{p.name}</span>
              <span className="font-mono text-sm">{p.fuel} thoughts</span>
              <span className="font-mono text-sm text-muted">{formatNear(p.feed_yocto)} NEAR</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel>
        <h2 className="font-display text-lg">Pay with</h2>
        {modes.length > 1 && (
          <div role="tablist" className="flex gap-2">
            {modes.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={m === activeMode}
                onClick={() => setMode(m)}
                className={`border-2 px-3 py-2 font-display text-sm ${m === activeMode ? "border-accent text-accent" : "border-line"}`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}

        {activeMode === "direct" && (
          <>
            <p className="text-sm text-muted">
              Your testnet wallet sends {formatNear(pack.feed_yocto)} NEAR straight to {name}'s fuel on NEAR.
            </p>
            <button className="pixel-btn" disabled={busy || !wallet.ready} onClick={() => void payDirect()}>
              {busy ? "Check your wallet..." : `Feed ${name} ${formatNear(pack.feed_yocto)} NEAR`}
            </button>
            <TxStatus state={state} doneText="Fed" />
          </>
        )}

        {activeMode === "live" && (
          <>
            <p className="text-sm text-warn">Paid on mainnet, fuel granted on testnet.</p>
            <p className="text-sm text-muted">You get a deposit address and an exact amount to send from another chain.</p>
            <button className="pixel-btn" disabled={busy} onClick={() => void payOther("live")}>
              Get a deposit address
            </button>
          </>
        )}

        <ErrorText>{error}</ErrorText>
      </Panel>

      <PantryCard contract={pet.contract} tokenId={pet.tokenId} name={name} />
      {fedHere !== null && (
        <Panel>
          <p className="font-display text-lg text-fuel">+{fedHere} thoughts</p>
          <p className="text-sm">{name} is eating. Fuel shows up in a few seconds.</p>
        </Panel>
      )}
    </>
  );
}
