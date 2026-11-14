"use client";

import Link from "next/link";
import { useState } from "react";
import { PetApproval, propose, type Proposal } from "@/components/device/ApprovalBanner";
import { OwnerGate } from "@/components/wallet/OwnerGate";
import { PetHeader } from "@/components/wallet/PetHeader";
import { PetPage } from "@/components/wallet/PetPage";
import { addRecipient, createApproval } from "@/components/wallet/brainApi";
import { ErrorText, Panel, TxStatus } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { useTx } from "@/components/wallet/useTx";
import { BrainRequestError } from "@/lib/brain";
import { accountExists, isAccountId, petPath, tx } from "@/lib/chain";
import { brainErrorCopy, chainErrorCopy } from "@/lib/errors";
import { useSession } from "@/lib/session";
import { useStream } from "@/lib/useStream";

// /pet/[petRef]/transfer (03 section 10, Build Spec 8): give the pet to another NEAR account.
export default function TransferPage() {
  return (
    <PetPage title={(name) => `Give ${name} away`}>
      {(pet) => (
        <>
          <PetHeader pet={pet} />
          <OwnerGate owner={pet.chain!.owner} name={pet.chain!.name} needSession={false}>
            <Transfer pet={pet} />
          </OwnerGate>
        </>
      )}
    </PetPage>
  );
}

function Transfer({ pet }: { pet: PetData }) {
  const c = pet.chain!;
  const name = c.name;
  const [recipient, setRecipient] = useState("");
  const [checking, setChecking] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [doneTo, setDoneTo] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const { send, state, busy } = useTx(name);
  const devicePaired = pet.brain?.device.paired ?? false;
  const to = recipient.trim().toLowerCase();

  if (doneTo) {
    return (
      <Panel>
        <p className="font-display text-lg">{name} now belongs to <span className="font-mono">{doneTo}</span>.</p>
        <p>{name}&apos;s new owner can pair {name} with their Petto.</p>
        <TxStatus state={state} doneText="Transferred" />
        <Link href="/my" className="pixel-btn self-start">See my pets</Link>
      </Panel>
    );
  }

  if (BigInt(c.staked) > 0n || c.pending_unstake) {
    return (
      <Panel>
        <p>{chainErrorCopy("E_STAKED", name)}</p>
        <p className="text-sm text-muted">
          {c.pending_unstake ? "NEAR is on its way back from the Brain Garden. Collect it first." : "Unplant it, wait 12 to 24 h, then collect it."}
        </p>
        <Link href={petPath(pet.contract, pet.tokenId, "/garden")} className="pixel-btn self-start">Open the Brain Garden</Link>
      </Panel>
    );
  }

  /** Checks the recipient; returns the error copy or null. */
  async function check(): Promise<string | null> {
    if (!isAccountId(to)) return "Enter a NEAR testnet account, like friend.testnet.";
    if (to === c.owner) return `You already own ${name}.`;
    try {
      if (!(await accountExists(to))) return `${to} doesn't exist on NEAR testnet. Check the spelling.`;
    } catch {
      return "Couldn't reach NEAR testnet. Retry in a moment.";
    }
    return null;
  }

  async function transferNow() {
    setChecking(true);
    const problem = await check();
    setChecking(false);
    setInputError(problem);
    if (problem) return;
    // approval mode (CLAUDE.md 7.3): propose Transfer; the device approves and the contract moves the pet
    if (c.approval_mode) return setProposal(await propose(send, pet, { Transfer: { receiver_id: to } }));
    const r = await send(tx.nftTransfer(pet.contract, to, pet.tokenId));
    if (r) {
      setDoneTo(to);
      await pet.reload();
    }
  }

  return (
    <>
      <Panel>
        <h2 className="font-display text-lg">Who gets {name}</h2>
        <p className="text-sm">
          {name} keeps its Soul, stage, traits and on-chain fuel. Chats and memories stay with you: the new owner
          starts fresh.{devicePaired ? ` Your Petto device stops working with ${name}.` : ""} This can&apos;t be undone.
        </p>
        <label className="flex flex-col gap-2">
          <span className="font-display text-sm">Recipient account</span>
          <input
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setInputError(null);
            }}
            placeholder="friend.testnet"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 w-full border-2 border-line bg-bg px-3 font-mono text-base"
          />
        </label>
        <ErrorText>{inputError}</ErrorText>
        <button className={`pixel-btn ${devicePaired && !c.approval_mode ? "pixel-btn--secondary" : ""}`} disabled={!to || busy || checking}
          onClick={() => void transferNow()}>
          {busy ? "Check your wallet..." : checking ? "Checking the account..." : c.approval_mode ? `Ask your Petto to give ${name} away` : `Give ${name} away`}
        </button>
        <TxStatus state={state} doneText={c.approval_mode ? "Request sent" : "Transferred"} />
        <PetApproval pet={pet} proposal={proposal} />
      </Panel>
      {devicePaired && !c.approval_mode && <DevicePath pet={pet} to={to} check={check} onError={setInputError} />}
    </>
  );
}

type DeviceStep =
  | { step: "idle" }
  | { step: "saving" }
  | { step: "waiting"; startedOnPhone: boolean }
  | { step: "ready"; approvalId: string }
  | { step: "error"; message: string };

/**
 * Device approval (Build Spec 8): the recipient is saved for the device, the device shows the
 * exact pet and recipient, the owner holds Approve, then signs on /approve/[id] in Meteor.
 */
function DevicePath({
  pet,
  to,
  check,
  onError,
}: {
  pet: PetData;
  to: string;
  check: () => Promise<string | null>;
  onError: (e: string | null) => void;
}) {
  const name = pet.chain!.name;
  const session = useSession();
  const [s, setS] = useState<DeviceStep>({ step: "idle" });

  useStream(pet.ref, session && s.step === "waiting" ? session.token : null, {
    approval_ready: (d) => {
      if (d.kind === "transfer_pet" && typeof d.id === "string") setS({ step: "ready", approvalId: d.id });
    },
  });

  async function start() {
    const problem = await check();
    onError(problem);
    if (problem) return;
    setS({ step: "saving" });
    try {
      await addRecipient({ label: to.slice(0, 32), account_id: to });
    } catch (err) {
      setS({ step: "error", message: brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name) });
      return;
    }
    try {
      await createApproval({ kind: "transfer_pet", receiver_id: to, token_id: pet.tokenId, pet_ref: pet.ref });
      setS({ step: "waiting", startedOnPhone: true });
    } catch (err) {
      // The brain lets only the device start an approval today: the owner starts it there.
      if (err instanceof BrainRequestError && (err.status === 401 || err.status === 403)) {
        setS({ step: "waiting", startedOnPhone: false });
      } else {
        setS({ step: "error", message: brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name) });
      }
    }
  }

  return (
    <Panel>
      <h2 className="font-display text-lg">Approve on your Petto</h2>
      <p className="text-sm">
        For an extra check, your Petto shows {name} and the recipient. Hold Approve on the device, then sign in
        your wallet.
      </p>
      {!session ? (
        <p className="text-sm text-muted">Sign in to Petto to use the device check.</p>
      ) : s.step === "idle" || s.step === "error" ? (
        <button className="pixel-btn" disabled={!to} onClick={() => void start()}>Send to my Petto</button>
      ) : s.step === "saving" ? (
        <p className="font-mono text-sm text-muted">Saving the recipient...</p>
      ) : s.step === "waiting" ? (
        <p className="font-mono text-sm text-muted">
          {s.startedOnPhone
            ? `Hold Approve on your Petto. Waiting for the device...`
            : `${to} is saved on your Petto. On the device, open Wallet, choose Transfer ${name}, pick ${to} and hold Approve. Waiting for the device...`}
        </p>
      ) : (
        <Link href={`/approve/${encodeURIComponent(s.approvalId)}`} className="pixel-btn self-start">Sign in your wallet</Link>
      )}
      {s.step === "error" && <ErrorText>{s.message}</ErrorText>}
    </Panel>
  );
}
