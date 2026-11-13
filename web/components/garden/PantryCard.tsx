"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatPetRef, type PetView } from "@nearling/shared";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { ErrorText, Panel, TxStatus } from "@/components/wallet/ui";
import { useTx } from "@/components/wallet/useTx";
import { formatNear, getConfig, getPet, nearToThoughts, parseNear, tx, type PetsConfig } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";

// Pantry (pets-v9, docs/CONTRACT_CHANGES_V9.md section 3): the owner stocks NEAR once from the
// wallet, the paired Petto moves it into food with its own key (capped per day).
// Capability detection: on a contract whose `get_pet` has no `pantry_yocto` the card renders nothing.

const PRESETS = ["0.1", "0.5", "1"] as const;

export function PantryCard({
  contract,
  tokenId,
  name,
  compact = false,
}: {
  contract: string;
  tokenId: string;
  name: string;
  /** one-line summary with a link to the full card on the feed page (pet home) */
  compact?: boolean;
}) {
  const [pet, setPet] = useState<PetView | null>(null);
  const [cfg, setCfg] = useState<PetsConfig | null>(null);

  const reload = useCallback(async () => {
    const [p, c] = await Promise.allSettled([getPet(contract, tokenId), getConfig(contract)]);
    if (p.status === "fulfilled") setPet(p.value);
    if (c.status === "fulfilled") setCfg(c.value);
  }, [contract, tokenId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!pet || !cfg || pet.pantry_yocto === undefined) return null;
  const pantry = BigInt(pet.pantry_yocto);
  const thoughts = nearToThoughts(pantry, cfg.near_usd_rate_micro, cfg.fuel_price_micro);
  const summary = `${formatNear(pantry)} NEAR, about ${thoughts} thoughts`;

  if (compact) {
    const href = `/feed/${encodeURIComponent(formatPetRef(contract, tokenId))}#pantry`;
    return (
      <Link href={href} className="flex items-center justify-between gap-2 border-2 border-line p-3 text-sm">
        <span>
          <span className="font-display">Pantry</span> <span className="font-mono">{summary}</span>
        </span>
        <span className="font-display text-accent">Open</span>
      </Link>
    );
  }

  const deviceCap = cfg.device_feed_max_per_day ? `up to ${formatNear(cfg.device_feed_max_per_day)} NEAR a day` : "with a daily limit";
  return (
    <Panel>
      <h2 id="pantry" className="font-display text-lg">
        Pantry
      </h2>
      <p className="font-mono">{summary}</p>
      <p className="text-sm text-muted">
        Stock the pantry once from your wallet. A paired Petto feeds itself from it with its own key, {deviceCap}. The
        NEAR stays yours until it becomes food.
      </p>
      <PantryActions pet={pet} contract={contract} tokenId={tokenId} name={name} pantry={pantry} onDone={reload} />
    </Panel>
  );
}

function PantryActions({
  pet,
  contract,
  tokenId,
  name,
  pantry,
  onDone,
}: {
  pet: PetView;
  contract: string;
  tokenId: string;
  name: string;
  pantry: bigint;
  onDone: () => Promise<void>;
}) {
  const wallet = useWallet();
  const [stock, setStock] = useState<string>(PRESETS[0]);
  const [feedAmount, setFeedAmount] = useState("0.1");
  const [emptyAmount, setEmptyAmount] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const { send, state, busy } = useTx(name);

  if (!wallet.accountId) {
    return (
      <>
        <p className="text-sm">Connect {name}'s owner wallet to stock the pantry.</p>
        <ConnectButton />
      </>
    );
  }
  if (wallet.accountId !== pet.owner) {
    return <p className="text-sm text-muted">Only {name}'s owner can stock or use the pantry.</p>;
  }

  const stockY = parseNear(stock);
  const feedY = parseNear(feedAmount);
  const feedOk = feedY !== null && feedY <= pantry;
  const emptyY = emptyAmount === "" ? pantry : parseNear(emptyAmount);
  const emptyOk = emptyY !== null && emptyY > 0n && emptyY <= pantry && !pet.approval_mode;

  // `expect`: an event the spec names for this call; without it the call changed nothing
  async function run(req: Parameters<typeof send>[0], expect?: { event: string; missing: string }) {
    setNote(null);
    const r = await send(req);
    if (!r) return;
    if (expect && !r.events.some((e) => e.event === expect.event)) setNote(expect.missing);
    await onDone();
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="font-display text-sm">Stock the pantry</span>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setStock(p)}
              aria-pressed={p === stock}
              className={`border-2 p-2 font-mono text-sm ${p === stock ? "border-accent" : "border-line"}`}
            >
              {p} NEAR
            </button>
          ))}
        </div>
        <button
          className="pixel-btn"
          disabled={busy || !stockY}
          onClick={() => stockY && void run(tx.stockPantry(contract, tokenId, stockY), { event: "pantry_stocked", missing: "The pantry didn't change. Check your wallet." })}
        >
          {busy ? "Check your wallet..." : `Stock ${stock} NEAR`}
        </button>
      </div>

      {pantry > 0n && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2">
            <span className="font-display text-sm">Feed from the pantry (no device needed)</span>
            <span className="flex items-center gap-2">
              <input
                inputMode="decimal"
                value={feedAmount}
                onChange={(e) => setFeedAmount(e.target.value)}
                className="h-12 w-full border-2 border-line bg-bg px-3 font-mono text-base"
              />
              <span className="font-mono">NEAR</span>
            </span>
          </label>
          {feedAmount && !feedOk && <ErrorText>Feed up to {formatNear(pantry)} NEAR from the pantry.</ErrorText>}
          <button
            className="pixel-btn pixel-btn--secondary"
            disabled={busy || !feedOk}
            onClick={() => feedY && void run(tx.feedFromPantry(contract, tokenId, feedY), { event: "fed", missing: "The pantry didn't feed. Try again." })}
          >
            {`Feed ${name} from the pantry`}
          </button>
        </div>
      )}

      {pantry > 0n && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2">
            <span className="font-display text-sm">Empty the pantry (blank = all)</span>
            <span className="flex items-center gap-2">
              <input
                inputMode="decimal"
                value={emptyAmount}
                placeholder={formatNear(pantry)}
                onChange={(e) => setEmptyAmount(e.target.value)}
                className="h-12 w-full border-2 border-line bg-bg px-3 font-mono text-base"
              />
              <span className="font-mono">NEAR</span>
            </span>
          </label>
          {pet.approval_mode && (
            <p className="text-sm text-muted">Approval mode is on. Turn it off on the Device page to empty the pantry.</p>
          )}
          <button
            className="pixel-btn pixel-btn--secondary"
            disabled={busy || !emptyOk}
            onClick={() => emptyY && void run(tx.emptyPantry(contract, tokenId, emptyY))}
          >
            {`Return ${emptyY ? formatNear(emptyY) : ""} NEAR to your wallet`}
          </button>
        </div>
      )}

      <TxStatus state={state} doneText="Done" />
      <ErrorText>{note}</ErrorText>
    </>
  );
}
