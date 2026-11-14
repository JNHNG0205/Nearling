"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { buildApprovalTx } from "@/components/wallet/approvalTx";
import { getApproval, reportApprovalTx, toMs, type Approval } from "@/components/wallet/brainApi";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { AppFrame, ErrorText, Panel, Spinner, TxLink, TxStatus } from "@/components/wallet/ui";
import { useTx } from "@/components/wallet/useTx";
import { BrainRequestError } from "@/lib/brain";
import { formatNear } from "@/lib/chain";
import { brainErrorCopy } from "@/lib/errors";
import { useSignIn } from "@/lib/wallet";

// /approve/[approvalId] (03 section 9, Build Spec 7 and 8). The transaction is built only from
// the approval record the device approved; the page has no editable fields.

const KIND_TITLE: Record<Approval["kind"], string> = {
  send: "Send NEAR",
  stake: "Stake NEAR",
  transfer_pet: "Give your pet away",
};

export default function ApprovePage() {
  const { approvalId } = useParams<{ approvalId: string }>();
  const { wallet, session } = useSignIn();
  const [approval, setApproval] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { send, state, busy } = useTx();

  const load = useCallback(async () => {
    try {
      setApproval(await getApproval(approvalId));
      setError(null);
    } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", "your pet"));
    }
  }, [approvalId]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  // wait for the hold-to-approve on the device
  useEffect(() => {
    if (!session || (approval && approval.status !== "requested")) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      void load();
    }, 3000);
    return () => window.clearInterval(id);
  }, [session, approval, load]);

  if (!session) {
    return (
      <AppFrame title="Approve on your phone">
        <Panel>
          <p>Connect the wallet your Petto is linked to.</p>
          <ConnectButton />
        </Panel>
      </AppFrame>
    );
  }
  if (!approval) {
    return <AppFrame title="Approve on your phone">{error ? <ErrorText>{error}</ErrorText> : <Spinner />}</AppFrame>;
  }

  const expiresAt = toMs(approval.expires_at);
  const expired = approval.status === "expired" || (expiresAt !== null && expiresAt < now && approval.status !== "final");
  const request = buildApprovalTx(approval);
  const wrongAccount = wallet.accountId !== approval.account_id;
  const amount = approval.amount_yocto ? `${formatNear(approval.amount_yocto, 6)} NEAR` : null;

  async function sign() {
    if (!request) return;
    const r = await send(request);
    if (!r?.hash) return;
    try {
      setApproval(await reportApprovalTx(approval!.id, r.hash));
    } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream"));
    }
  }

  return (
    <AppFrame title={KIND_TITLE[approval.kind]}>
      <Panel>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-sm text-muted">From</dt>
          <dd className="break-all font-mono text-sm">{approval.account_id}</dd>
          <dt className="text-sm text-muted">{approval.kind === "stake" ? "Validator" : "To"}</dt>
          <dd className="break-all font-mono text-sm">{approval.kind === "stake" ? approval.validator ?? approval.receiver_id : approval.receiver_id}</dd>
          {amount && (
            <>
              <dt className="text-sm text-muted">Amount</dt>
              <dd className="font-mono text-sm">{amount}</dd>
            </>
          )}
          {approval.kind === "transfer_pet" && (
            <>
              <dt className="text-sm text-muted">Pet</dt>
              <dd className="break-all font-mono text-sm">{approval.pet_ref}</dd>
            </>
          )}
          <dt className="text-sm text-muted">Network</dt>
          <dd className="font-mono text-sm">{approval.network}</dd>
        </dl>
      </Panel>

      {approval.status === "requested" && !expired && (
        <Panel>
          <p className="font-display">Hold Approve on your Petto first</p>
          <Spinner label="Waiting for your Petto..." />
        </Panel>
      )}

      {approval.status === "approved" && !expired && (
        <>
          {!request ? (
            <ErrorText>This request can't be signed here. Start again on your Petto.</ErrorText>
          ) : wrongAccount ? (
            <ErrorText>Connect {approval.account_id} to sign this.</ErrorText>
          ) : (
            <button className="pixel-btn" disabled={busy} onClick={() => void sign()}>
              {busy ? "Check your wallet..." : "Sign in your wallet"}
            </button>
          )}
          <TxStatus state={state} doneText="Signed" />
        </>
      )}

      {(approval.status === "signed" || approval.status === "final") && (
        <Panel>
          <p className="font-display text-fuel">{approval.status === "final" ? "Done" : "Signed, confirming..."}</p>
          {approval.tx_hash && <TxLink hash={approval.tx_hash} />}
        </Panel>
      )}
      {expired && approval.status !== "final" && <ErrorText>This request has expired. Start again on your Petto.</ErrorText>}
      {approval.status === "rejected" && <ErrorText>This request was rejected on your Petto.</ErrorText>}
      {approval.status === "failed" && <ErrorText>This request failed. Start again on your Petto.</ErrorText>}
      <ErrorText>{error}</ErrorText>
    </AppFrame>
  );
}
