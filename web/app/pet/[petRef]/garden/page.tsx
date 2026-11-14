"use client";

import { useEffect, useState } from "react";
import { PetApproval, propose, type Proposal } from "@/components/device/ApprovalBanner";
import { OwnerGate } from "@/components/wallet/OwnerGate";
import { PetHeader } from "@/components/wallet/PetHeader";
import { PetPage } from "@/components/wallet/PetPage";
import { ErrorText, Panel, TxStatus } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { useTx } from "@/components/wallet/useTx";
import {
  currentEpoch,
  eventData,
  formatNear,
  getConfig,
  MIN_STAKE,
  parseNear,
  spareThoughtsPerDay,
  tx,
  withdrawTotal,
} from "@/lib/chain";

// /pet/[petRef]/garden Brain Garden (03 section 8, Build Spec 9): NEARON stake grows AI credit.
export default function GardenPage() {
  return (
    <PetPage title={() => "Brain Garden"}>
      {(pet) => (
        <>
          <PetHeader pet={pet} />
          <Garden pet={pet} />
        </>
      )}
    </PetPage>
  );
}

const DAY_MS = 86_400_000;

function Garden({ pet }: { pet: PetData }) {
  const c = pet.chain!;
  const [fuelPrice, setFuelPrice] = useState(1000);
  const [metabolism, setMetabolism] = useState(1000);
  const [minStake, setMinStake] = useState<bigint>(MIN_STAKE);
  // pets-v9 config.pool_unstake_deposit (0 on v8); null until config() loads, so unstake waits for it
  const [unstakeDeposit, setUnstakeDeposit] = useState<bigint | null>(null);
  const [configError, setConfigError] = useState(false);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    getConfig(pet.contract)
      .then((cfg) => {
        setFuelPrice(cfg.fuel_price_micro || 1000);
        setMetabolism(cfg.metabolism_micro_per_day);
        setMinStake(BigInt(cfg.min_stake));
        setUnstakeDeposit(BigInt(cfg.pool_unstake_deposit ?? "0"));
      })
      .catch(() => setConfigError(true));
  }, [pet.contract]);

  useEffect(() => setLoadedAt(Date.now()), [c]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const staked = BigInt(c.staked);
  // live ticker: credit_micro + daily_credit_micro x elapsed (03 section 8)
  const credit = c.credit_micro + (c.daily_credit_micro * (now - loadedAt)) / DAY_MS;
  // what the stake pays for beyond metabolism (staying alive)
  const thoughtsPerDay = spareThoughtsPerDay(c.daily_credit_micro, metabolism, fuelPrice);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Planted" value={`${formatNear(staked)} NEAR`} />
        <Stat label="Credit growing" value={`$${(credit / 1e6).toFixed(6)}`} />
        <Stat label="Fuel ready" value={`${Math.floor(credit / fuelPrice)} thoughts`} />
        <Stat label="Per day" value={`+${thoughtsPerDay.toFixed(1)} thoughts`} />
      </div>
      {c.self_sustaining ? (
        <p className="border-2 border-fuel p-3 font-display text-fuel">Self-sustaining: {c.name}'s Garden pays for every thought.</p>
      ) : staked === 0n ? (
        <p className="text-sm text-muted">Plant NEAR so {c.name}'s brain grows its own fuel.</p>
      ) : null}

      <OwnerGate owner={c.owner} name={c.name} needSession={false}>
        <Plant pet={pet} minStake={minStake} />
        {c.pending_unstake ? (
          <Collect pet={pet} amount={withdrawTotal(c.pending_unstake)} unlockEpoch={c.pending_unstake.unlock_epoch} />
        ) : (
          staked > 0n && <Unplant pet={pet} staked={staked} deposit={unstakeDeposit} configError={configError} />
        )}
      </OwnerGate>

      <p className="text-sm text-muted">While NEAR is planted, {c.name} can't be given away.</p>
      <p className="text-sm text-muted">
        Staking runs through NEARON, a testnet prototype that turns staked NEAR into NEAR AI credit. Unstaked NEAR
        returns after 12 to 24 hours.
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pixel-panel flex flex-col gap-1 p-3">
      <span className="font-display text-sm text-muted">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function AmountInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-display text-sm">{label}</span>
      <span className="flex items-center gap-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full border-2 border-line bg-bg px-3 font-mono text-base"
        />
        <span className="font-mono">NEAR</span>
      </span>
    </label>
  );
}

function Plant({ pet, minStake }: { pet: PetData; minStake: bigint }) {
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const { send, state, busy } = useTx(pet.chain!.name);
  const y = parseNear(amount);
  const ok = y !== null && y >= minStake;

  async function plant() {
    if (!y) return;
    setNote(null);
    // approval mode (CLAUDE.md 7.3): propose; the device approves and runs the stake with the held deposit
    if (pet.chain!.approval_mode) return setProposal(await propose(send, pet, { Stake: { amount: y.toString() } }, y));
    const r = await send(tx.stake(pet.contract, pet.tokenId, y));
    if (!r) return;
    // `staked` is emitted in the callback; without it NEARON refused and the NEAR came back
    if (eventData(r.events, "staked").length === 0) setNote("The Brain Garden didn't take the NEAR. It was sent back to you.");
    await pet.reload();
  }

  return (
    <Panel>
      <h2 className="font-display text-lg">Plant NEAR</h2>
      <AmountInput label="Amount (at least 1 NEAR)" value={amount} onChange={setAmount} />
      {amount && !ok && <ErrorText>Plant at least {formatNear(minStake)} NEAR in the Brain Garden.</ErrorText>}
      <button className="pixel-btn" disabled={!ok || busy} onClick={() => void plant()}>
        {busy ? "Check your wallet..." : `Plant ${y ? formatNear(y) : ""} NEAR`}
      </button>
      <TxStatus state={state} doneText="Transaction sent" />
      <ErrorText>{note}</ErrorText>
      <PetApproval pet={pet} proposal={proposal} />
    </Panel>
  );
}

function Unplant({
  pet,
  staked,
  deposit,
  configError,
}: {
  pet: PetData;
  staked: bigint;
  deposit: bigint | null;
  configError: boolean;
}) {
  const [amount, setAmount] = useState(formatNear(staked));
  const [note, setNote] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const { send, state, busy } = useTx(pet.chain!.name);
  const y = parseNear(amount);
  const ok = y !== null && y <= staked && deposit !== null;

  async function unplant() {
    if (!y || deposit === null) return;
    setNote(null);
    // approval mode: the proposal holds the pool unstake deposit (pets-v9) until the device approves
    if (pet.chain!.approval_mode) return setProposal(await propose(send, pet, { Unstake: { amount: y.toString() } }, deposit));
    const r = await send(tx.unstake(pet.contract, pet.tokenId, y, deposit));
    if (!r) return;
    // `unstaked` is emitted in the callback; without it NEARON refused, the stake stayed and the deposit came back
    if (eventData(r.events, "unstaked").length === 0) setNote("The Brain Garden kept the NEAR planted. Your deposit was sent back.");
    await pet.reload();
  }

  return (
    <Panel>
      <h2 className="font-display text-lg">Take NEAR out</h2>
      <AmountInput label={`Amount (up to ${formatNear(staked)} NEAR)`} value={amount} onChange={setAmount} />
      <p className="text-sm text-muted">It returns in 12 to 24 h. Then collect it here.</p>
      {deposit !== null && deposit > 0n && (
        <p className="text-sm text-muted">{formatNear(deposit, 5)} NEAR is held by the pool and returned with your NEAR.</p>
      )}
      {configError && <ErrorText>Couldn&apos;t load the Garden settings. Refresh to try again.</ErrorText>}
      <button className="pixel-btn pixel-btn--secondary" disabled={!ok || busy} onClick={() => void unplant()}>
        {busy ? "Check your wallet..." : `Unplant ${y ? formatNear(y) : ""} NEAR`}
      </button>
      <TxStatus state={state} doneText="Transaction sent" />
      <ErrorText>{note}</ErrorText>
      <PetApproval pet={pet} proposal={proposal} />
    </Panel>
  );
}

/** `amount`: what withdraw pays, the unstaked NEAR plus the pool unstake deposit. */
function Collect({ pet, amount, unlockEpoch }: { pet: PetData; amount: bigint; unlockEpoch: string }) {
  const [epoch, setEpoch] = useState<bigint | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const { send, state, busy } = useTx(pet.chain!.name);

  useEffect(() => {
    currentEpoch()
      .then(setEpoch)
      .catch(() => setEpoch(null));
  }, []);

  const unlocked = epoch !== null && epoch >= BigInt(unlockEpoch);

  async function collect() {
    setNote(null);
    if (pet.chain!.approval_mode) return setProposal(await propose(send, pet, "Withdraw"));
    const r = await send(tx.withdraw(pet.contract, pet.tokenId));
    if (!r) return;
    // NEARON may not have collected the funds yet; the unstake then stays pending
    if (eventData(r.events, "unstake_withdrawn").length === 0) setNote("Withdrawal processing, retry later.");
    await pet.reload();
  }

  return (
    <Panel>
      <h2 className="font-display text-lg">On its way back</h2>
      <p className="font-mono">{formatNear(amount)} NEAR</p>
      <p className="text-sm text-muted">
        Unlocks at epoch {unlockEpoch}
        {epoch !== null ? ` (now ${epoch.toString()})` : ""}. Epochs last about 12 h.
      </p>
      <button className="pixel-btn" disabled={busy || (epoch !== null && !unlocked)} onClick={() => void collect()}>
        {busy ? "Check your wallet..." : `Collect ${formatNear(amount)} NEAR`}
      </button>
      <TxStatus state={state} doneText="Transaction sent" />
      <ErrorText>{note}</ErrorText>
      <PetApproval pet={pet} proposal={proposal} />
    </Panel>
  );
}
