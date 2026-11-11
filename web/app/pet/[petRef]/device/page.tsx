"use client";

import { useCallback, useEffect, useState } from "react";
import { PetApproval, propose, type Proposal } from "@/components/device/ApprovalBanner";
import { getDeviceStatus, unpair, type DeviceStatus } from "@/components/wallet/brainApi";
import { OwnerGate } from "@/components/wallet/OwnerGate";
import { PetHeader } from "@/components/wallet/PetHeader";
import { PetPage } from "@/components/wallet/PetPage";
import { ErrorText, Panel, TxStatus } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { useTx } from "@/components/wallet/useTx";
import { BrainRequestError } from "@/lib/brain";
import { hasPantry, outcomeFailure, tx, type TxRequest } from "@/lib/chain";
import { brainErrorCopy, CANCELLED, errorText, friendlyChainError, isWalletRejection } from "@/lib/errors";
import { useSession } from "@/lib/session";
import { useStream } from "@/lib/useStream";
import { useWallet } from "@/lib/wallet";

// /pet/[petRef]/device (web-app architectual/03): pair, give the Nearling its limited key,
// approval mode, remove. Value actions are then proposed here and approved on the device (CLAUDE.md 7.3).
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

function Step({ n, title, done, children }: { n: string; title: string; done: boolean; children?: React.ReactNode }) {
  return (
    <Panel>
      <h2 className="flex items-center gap-2 font-display text-lg">
        <span className="font-mono text-muted">{n}</span>
        <span className="flex-1">{title}</span>
        <span className={`font-mono text-sm ${done ? "text-fuel" : "text-muted"}`}>{done ? "Done" : "To do"}</span>
      </h2>
      {children}
    </Panel>
  );
}

const short = (pk: string) => `${pk.slice(0, 14)}...${pk.slice(-4)}`;

function Device({ pet }: { pet: PetData }) {
  const c = pet.chain!;
  const name = c.name;
  const wallet = useWallet();
  const session = useSession();
  const [st, setSt] = useState<DeviceStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSt(await getDeviceStatus(pet.ref));
      setLoadError(null);
    } catch (err) {
      setLoadError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name));
    }
  }, [pet.ref, name]);

  useEffect(() => {
    void load();
  }, [load, c]);

  useStream(pet.ref, session?.token ?? null, { paired: () => void load() });

  if (!st) {
    return loadError ? <ErrorText>{loadError}</ErrorText> : <p className="font-mono text-sm text-muted">Checking your Nearling...</p>;
  }

  const keyOnChain = !!st.device_pk && c.device_pk === st.device_pk;
  const keyReady = keyOnChain && st.key_added === true;

  return (
    <>
      <Step n="1" title="Pair your Nearling" done={st.paired}>
        {st.paired ? (
          <p className="text-sm text-muted">
            {st.last_seen_at ? `Last seen ${new Date(st.last_seen_at).toLocaleString()}.` : "Not seen online yet."}
          </p>
        ) : (
          <p className="text-sm text-muted">
            Turn on your Nearling and scan the QR code on its screen with this phone (or pair over Bluetooth). Pick {name}{" "}
            when asked.
          </p>
        )}
      </Step>

      {st.paired && (
        <Step n="2" title="Give your Nearling its key" done={keyReady}>
          <GiveKey pet={pet} st={st} keyOnChain={keyOnChain} reload={load} wallet={wallet} />
        </Step>
      )}

      {st.paired && keyOnChain && (
        <Step n="3" title="Approve on the device" done={c.approval_mode}>
          <ApprovalMode pet={pet} />
        </Step>
      )}

      {(st.paired || st.key_added) && <Remove pet={pet} st={st} reload={load} />}
      <ErrorText>{loadError}</ErrorText>
    </>
  );
}

/** Step 2: one wallet prompt, AddKey on the owner's own account + register_device on the pets contract. */
function GiveKey({
  pet,
  st,
  keyOnChain,
  reload,
  wallet,
}: {
  pet: PetData;
  st: DeviceStatus;
  keyOnChain: boolean;
  reload: () => Promise<void>;
  wallet: ReturnType<typeof useWallet>;
}) {
  const c = pet.chain!;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const one = useTx(c.name);

  if (!st.device_pk) {
    return (
      <p className="text-sm text-muted">
        Your Nearling hasn&apos;t shared its key yet. Restart it on Wi-Fi so it says hello to the brain, then refresh.
      </p>
    );
  }
  if (st.key_added === null) {
    return (
      <>
        <ErrorText>Couldn&apos;t check your account keys on NEAR testnet.</ErrorText>
        <button className="pixel-btn pixel-btn--secondary self-start" onClick={() => void reload()}>Check again</button>
      </>
    );
  }
  const pk = st.device_pk;
  if (keyOnChain && st.key_added) {
    return (
      <p className="text-sm text-muted">
        Key <span className="font-mono">{short(pk)}</span> can call {c.name}&apos;s contract only: play, plant food and approve
        your requests{hasPantry(c) ? ", feed from the pantry" : ""}. It can never send NEAR anywhere else.
      </p>
    );
  }

  // Under approval mode a new device key is itself a request the current device approves.
  const registerByProposal = !keyOnChain && c.approval_mode;

  async function give() {
    setBusy(true);
    setMsg(null);
    const reqs: TxRequest[] = [];
    if (!st.key_added) reqs.push(tx.addDeviceKey(c.owner, pet.contract, pk, hasPantry(c)));
    if (!keyOnChain && !registerByProposal) reqs.push(tx.registerDevice(pet.contract, pet.tokenId, pk));
    try {
      if (reqs.length > 0) {
        const outcomes = await wallet.signAndSendTransactions(reqs);
        const failed = outcomes.map((o) => (o ? outcomeFailure(o) : null)).find((f) => f);
        if (failed) {
          setMsg(friendlyChainError(failed, c.name).message);
          return;
        }
      }
      if (registerByProposal) setProposal(await propose(one.send, pet, { RegisterDevice: { public_key: pk } }));
      await pet.reload();
      await reload();
    } catch (err) {
      setMsg(isWalletRejection(err) ? CANCELLED : friendlyChainError(errorText(err), c.name).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-sm">
        Your Nearling signs with its own key <span className="font-mono">{short(pk)}</span>. One wallet prompt adds it to your
        account as a limited key (only {c.name}&apos;s contract; play, plant food, approve
        {hasPantry(c) ? ", feed from the pantry" : ""}; 1 NEAR for gas) and tells {c.name} which device is its body.
      </p>
      {registerByProposal && (
        <p className="text-sm text-muted">Approvals are on, so your current Nearling must approve the new key.</p>
      )}
      <button className="pixel-btn self-start" disabled={busy || one.busy} onClick={() => void give()}>
        {busy ? "Check your wallet..." : "Give your Nearling its key"}
      </button>
      <ErrorText>{msg}</ErrorText>
      <TxStatus state={one.state} doneText="Request sent" />
      <PetApproval pet={pet} proposal={proposal} />
    </>
  );
}

/** Step 3: on = direct `set_approval_mode(true)`; off is gated, so it is a request the device approves. */
function ApprovalMode({ pet }: { pet: PetData }) {
  const c = pet.chain!;
  const { send, state, busy } = useTx(c.name);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  async function turnOn() {
    const r = await send(tx.setApprovalMode(pet.contract, pet.tokenId, true));
    if (r) await pet.reload();
  }

  return (
    <>
      {c.approval_mode ? (
        <p className="text-sm">
          On. Planting, unplanting, collecting and giving {c.name} away start here and only run after you hold Approve on
          your Nearling.
        </p>
      ) : (
        <p className="text-sm">
          Turn on to make your Nearling a second lock: value actions from this phone wait until you hold Approve on the
          device. A stolen phone wallet alone can&apos;t move {c.name}&apos;s NEAR.
        </p>
      )}
      {c.approval_mode ? (
        <button
          className="pixel-btn pixel-btn--secondary self-start"
          disabled={busy || !!proposal}
          onClick={() => void propose(send, pet, { SetApprovalMode: { on: false } }).then(setProposal)}
        >
          {busy ? "Check your wallet..." : "Turn approvals off"}
        </button>
      ) : (
        <button className="pixel-btn self-start" disabled={busy} onClick={() => void turnOn()}>
          {busy ? "Check your wallet..." : "Turn approvals on"}
        </button>
      )}
      <TxStatus state={state} doneText={c.approval_mode ? "Request sent" : "Approvals on"} />
      <PetApproval pet={pet} proposal={proposal} />
    </>
  );
}

/** Remove: delete the limited key from the owner's account, then unpair in the brain. */
function Remove({ pet, st, reload }: { pet: PetData; st: DeviceStatus; reload: () => Promise<void> }) {
  const c = pet.chain!;
  const { send, state, busy } = useTx(c.name);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    if (st.key_added && st.device_pk) {
      const r = await send(tx.deleteKey(c.owner, st.device_pk));
      if (!r) return;
    }
    try {
      if (st.paired) await unpair(pet.ref);
      setConfirm(false);
      await pet.reload();
      await reload();
    } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", c.name));
    }
  }

  return (
    <Panel>
      <h2 className="font-display text-lg">Remove this Nearling</h2>
      {c.approval_mode ? (
        <p className="text-sm text-muted">Turn approvals off first: without its key the device could never approve again.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Deletes the device key from your account and unpairs it. {c.name}, its fuel and its Soul stay on NEAR.
          </p>
          {confirm ? (
            <div className="flex gap-3">
              <button className="pixel-btn" disabled={busy} onClick={() => void remove()}>
                {busy ? "Check your wallet..." : `Remove`}
              </button>
              <button className="pixel-btn pixel-btn--secondary" onClick={() => setConfirm(false)}>
                Keep it
              </button>
            </div>
          ) : (
            <button className="pixel-btn pixel-btn--secondary self-start" onClick={() => setConfirm(true)}>
              Remove this Nearling
            </button>
          )}
        </>
      )}
      <TxStatus state={state} doneText="Key deleted" />
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}
