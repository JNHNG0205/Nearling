"use client";

import { useEffect, useRef, useState } from "react";
import { actionSummary, type ContractAction } from "@nearling/shared";
import { Panel, TxStatus } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { useTx, type TxResult } from "@/components/wallet/useTx";
import { eventData, getPendingActions, returnValue, tx, type TxRequest } from "@/lib/chain";

/** A `propose_action` that waits for the device (CLAUDE.md 7.3). */
export interface Proposal {
  id: string;
  action: ContractAction;
}

/** The action id from a `propose_action` outcome (return value, else the `action_proposed` event). */
export function proposalFrom(r: TxResult, action: ContractAction): Proposal | null {
  const id = returnValue<string>(r.outcome) ?? eventData<{ id?: string }>(r.events, "action_proposed")[0]?.id ?? null;
  return id ? { id: String(id), action } : null;
}

/** Sends `propose_action` through a page's `useTx().send`; the Proposal to show, or null if not sent. */
export async function propose(
  send: (req: TxRequest) => Promise<TxResult | null>,
  pet: Pick<PetData, "contract" | "tokenId">,
  action: ContractAction,
  deposit: bigint = 0n,
): Promise<Proposal | null> {
  const r = await send(tx.proposeAction(pet.contract, pet.tokenId, action, deposit));
  return r ? proposalFrom(r, action) : null;
}

/** ApprovalBanner for a pet page; reloads the pet when the request ends. */
export function PetApproval({ pet, proposal }: { pet: PetData; proposal: Proposal | null }) {
  if (!proposal) return null;
  return (
    <ApprovalBanner
      key={proposal.id}
      contract={pet.contract}
      tokenId={pet.tokenId}
      petName={pet.chain?.name ?? "your pet"}
      proposal={proposal}
      onDone={() => void pet.reload()}
    />
  );
}

type Phase = "waiting" | "approved" | "expired" | "cancelled";
const POLL_MS = 3_000;

/**
 * "Approve on your Nearling": polls `get_pending_actions` every 3 s until the action is gone
 * (approved on the device) or expired. Cancel calls `cancel_action` from the wallet (refunds any deposit).
 */
export function ApprovalBanner({
  contract,
  tokenId,
  petName,
  proposal,
  onDone,
}: {
  contract: string;
  tokenId: string;
  petName: string;
  proposal: Proposal;
  onDone?: (phase: Exclude<Phase, "waiting">) => void;
}) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cancel = useTx(petName);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (phase !== "waiting") return;
    let stopped = false;
    const check = async () => {
      try {
        const list = await getPendingActions(contract, tokenId);
        if (stopped) return;
        const mine = list.find((a) => a.id === proposal.id);
        if (!mine) {
          setPhase("approved");
          done.current?.("approved");
          return;
        }
        const exp = Number(BigInt(mine.expires_at_ns) / 1_000_000n);
        setExpiresAt(exp);
        if (exp <= Date.now()) {
          setPhase("expired");
          done.current?.("expired");
        }
      } catch {
        // RPC hiccup: try again next round
      }
    };
    void check();
    const id = window.setInterval(() => {
      setNow(Date.now());
      void check();
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [contract, tokenId, proposal.id, phase]);

  async function doCancel() {
    const r = await cancel.send(tx.cancelAction(contract, proposal.id));
    if (r) {
      setPhase("cancelled");
      done.current?.("cancelled");
    }
  }

  const summary = actionSummary(proposal.action, petName);
  const left = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 60_000)) : null;

  return (
    <Panel>
      {phase === "waiting" && (
        <>
          <h2 className="font-display text-lg">Approve on your Nearling</h2>
          <p className="font-mono">{summary}</p>
          <p className="text-sm text-muted">
            Your Nearling shows this request. Hold Approve on the device for 2 seconds.
            {left !== null ? ` It expires in about ${left} min.` : ""}
          </p>
          <p className="font-mono text-sm text-muted" aria-live="polite">Waiting for the device...</p>
          <button className="pixel-btn pixel-btn--secondary self-start" disabled={cancel.busy} onClick={() => void doCancel()}>
            {cancel.busy ? "Check your wallet..." : "Cancel request"}
          </button>
        </>
      )}
      {phase === "approved" && <p className="font-display text-fuel">Approved on your Nearling: {summary}.</p>}
      {phase === "expired" && (
        <>
          <p className="text-sm">The request expired before the device approved it. Cancel it to get any NEAR it held back.</p>
          <button className="pixel-btn pixel-btn--secondary self-start" disabled={cancel.busy} onClick={() => void doCancel()}>
            {cancel.busy ? "Check your wallet..." : "Cancel and refund"}
          </button>
        </>
      )}
      {phase === "cancelled" && <p className="text-sm text-muted">Request cancelled. Any NEAR it held went back to you.</p>}
      <TxStatus state={cancel.state} doneText="Cancelled" />
    </Panel>
  );
}
