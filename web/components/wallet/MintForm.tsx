"use client";

import { BODY_PALETTES, PATTERNS } from "@petto/sprites";
import { useEffect, useState } from "react";
import { PetSprite } from "@/components/PetSprite";
import { eventData, formatNear, getMintPrice, returnValue, soulBytes, SOUL_MAX_BYTES, tx, type PetLook } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";
import { ErrorText, TxStatus } from "./ui";
import { useTx } from "./useTx";

/** Pulls the minted token id from the return value or the NEP-171 `nft_mint` event. */
function mintedTokenId(r: { outcome: Parameters<typeof returnValue>[0]; events: Parameters<typeof eventData>[0] }) {
  const v = returnValue<string>(r.outcome);
  if (typeof v === "string") return v;
  const m = eventData<{ token_ids?: string[] }>(r.events, "nft_mint")[0];
  return m?.token_ids?.[0] ?? null;
}

export function SoulField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const bytes = soulBytes(value);
  const over = bytes > SOUL_MAX_BYTES;
  return (
    <label className="flex flex-col gap-2">
      <span className="font-display text-sm">Soul (optional)</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="border-2 border-line bg-bg p-3 text-base"
        placeholder="A curious little pet who loves stars and puns."
      />
      <span className={`font-mono text-sm ${over ? "text-danger" : "text-muted"}`}>
        {bytes} / {SOUL_MAX_BYTES} bytes{over ? " (too long)" : ""}
      </span>
      <span className="text-sm text-muted">Your pet's personality is public on NEAR.</span>
    </label>
  );
}

const rgb = ([r, g, b]: readonly number[]) => `rgb(${r}, ${g}, ${b})`;

/** Body colour and pattern, previewed on the baby the egg hatches into (contract `look`). */
export function LookPicker({ look, onChange }: { look: PetLook; onChange: (l: PetLook) => void }) {
  const colourName = BODY_PALETTES[look.colour]?.name ?? "";
  return (
    <div className="flex flex-col gap-3">
      <span className="font-display text-sm">Look</span>
      <div className="flex flex-wrap items-center gap-4">
        <PetSprite traits={[look.colour, 0, look.pattern, 0, 0]} stageIndex={1} winged={false} state="happy" scale={3}
          label={`Your pet: ${colourName}, ${PATTERNS[look.pattern]}`} />
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Colour">
            {BODY_PALETTES.map((p, i) => (
              <button key={p.name} type="button" title={p.name} aria-label={p.name} aria-pressed={look.colour === i}
                onClick={() => onChange({ ...look, colour: i })}
                className={`size-9 border-2 ${look.colour === i ? "border-accent" : "border-line"}`}
                style={{ background: rgb(p.colours[1]), boxShadow: look.colour === i ? "inset 0 0 0 2px var(--p-bg)" : undefined }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pattern">
            {PATTERNS.map((name, i) => (
              <button key={name} type="button" aria-pressed={look.pattern === i} onClick={() => onChange({ ...look, pattern: i })}
                className={`border-2 px-3 py-1 font-display text-sm capitalize ${look.pattern === i ? "border-accent text-accent" : "border-line"}`}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Name + look + optional Soul + mint on one pets contract. Calls `onMinted` with the new token id. */
export function MintForm({
  contract,
  defaultSoul = "",
  onMinted,
}: {
  contract: string;
  defaultSoul?: string;
  onMinted: (tokenId: string) => void;
}) {
  const wallet = useWallet();
  const [name, setName] = useState("");
  const [soul, setSoul] = useState(defaultSoul);
  const [look, setLook] = useState<PetLook>({ colour: 2, pattern: 1 });
  const [price, setPrice] = useState<bigint | null>(null);
  const [priceError, setPriceError] = useState(false);
  const [missingId, setMissingId] = useState(false);
  const { send, state, busy } = useTx(name || "your pet");

  useEffect(() => {
    let live = true;
    setPrice(null);
    setPriceError(false);
    getMintPrice(contract)
      .then((p) => live && setPrice(p))
      .catch(() => live && setPriceError(true));
    return () => {
      live = false;
    };
  }, [contract]);

  const nameBytes = new TextEncoder().encode(name.trim()).length;
  const nameOk = nameBytes >= 1 && nameBytes <= 32;
  const soulOk = soulBytes(soul) <= SOUL_MAX_BYTES;
  const canMint = !!wallet.accountId && nameOk && soulOk && price !== null && !busy;

  async function mint() {
    if (price === null) return;
    setMissingId(false);
    const r = await send(tx.mintPet(contract, name.trim(), soul.trim() || null, price, look));
    if (!r) return;
    const id = mintedTokenId(r);
    if (id) onMinted(id);
    else setMissingId(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="font-display text-sm">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          className="h-12 border-2 border-line bg-bg px-3 text-base"
          placeholder="Mochi"
        />
        {name && !nameOk && <ErrorText>Names need 1 to 32 characters.</ErrorText>}
      </label>
      <LookPicker look={look} onChange={setLook} />
      <SoulField value={soul} onChange={setSoul} />
      <button className="pixel-btn" disabled={!canMint} onClick={() => void mint()}>
        {busy ? "Check your wallet..." : `Hatch ${name.trim() || "my pet"}${price !== null ? ` for ${formatNear(price)} NEAR` : ""}`}
      </button>
      {priceError && <ErrorText>Couldn't read the price from NEAR testnet. Refresh to retry.</ErrorText>}
      {!wallet.accountId && <p className="text-sm text-muted">Connect your wallet first.</p>}
      <TxStatus state={state} doneText="Hatched" />
      {missingId && <ErrorText>Your pet was minted, but we couldn't read its number. Find it under My pets.</ErrorText>}
    </div>
  );
}
