"use client";

import { useCallback, useEffect, useState } from "react";
import { addRecipient, getRecipients, getWalletInfo, type Recipient, type WalletInfo } from "@/components/wallet/brainApi";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { AppFrame, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import { BrainRequestError } from "@/lib/brain";
import { formatNear } from "@/lib/chain";
import { brainErrorCopy } from "@/lib/errors";
import { useSignIn } from "@/lib/wallet";

// /wallet (03 section 9, P1): balances and the saved recipients the device picks from.

const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export default function WalletPage() {
  const { session } = useSignIn();
  return (
    <AppFrame title="Wallet" back="/">
      <Panel>
        <ConnectButton />
      </Panel>
      {session ? <Wallet /> : <p className="text-sm text-muted">Sign in to see balances and saved recipients.</p>}
    </AppFrame>
  );
}

function Wallet() {
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [label, setLabel] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream"));

  const load = useCallback(async () => {
    const [w, r] = await Promise.allSettled([getWalletInfo(), getRecipients()]);
    if (w.status === "fulfilled") setInfo(w.value);
    else fail(w.reason);
    setRecipients(r.status === "fulfilled" ? r.value : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accountOk = ACCOUNT_RE.test(account.trim());
  const labelOk = label.trim().length > 0 && label.trim().length <= 24;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addRecipient({ label: label.trim(), account_id: account.trim() });
      setLabel("");
      setAccount("");
      setRecipients(await getRecipients());
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel>
        <h2 className="font-display text-lg">Balances (testnet)</h2>
        {info ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-sm text-muted">Available</dt>
            <dd className="font-mono">{formatNear(info.liquid_yocto)} NEAR</dd>
            <dt className="text-sm text-muted">Staked</dt>
            <dd className="font-mono">{formatNear(info.staked_yocto)} NEAR</dd>
            {info.validator && (
              <>
                <dt className="text-sm text-muted">Validator</dt>
                <dd className="break-all font-mono text-sm">{info.validator}</dd>
              </>
            )}
          </dl>
        ) : (
          !error && <Spinner />
        )}
        <p className="text-sm text-muted">Send and stake start on your Nearling. You approve there, then sign here in Meteor.</p>
      </Panel>

      <Panel>
        <h2 className="font-display text-lg">Saved recipients</h2>
        <p className="text-sm text-muted">Your Nearling picks from this list, so nobody types an address on the device.</p>
        {recipients === null ? (
          <Spinner />
        ) : recipients.length === 0 ? (
          <p className="text-sm text-muted">No saved recipients yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recipients.map((r) => (
              <li key={r.account_id} className="flex justify-between gap-3 border-b-2 border-line pb-2">
                <span className="font-display">{r.label}</span>
                <span className="break-all font-mono text-sm">{r.account_id}</span>
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-col gap-2">
          <span className="font-display text-sm">Name</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={24}
            className="h-12 border-2 border-line bg-bg px-3 text-base"
            placeholder="Mum"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-display text-sm">Testnet account</span>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value.toLowerCase())}
            autoCapitalize="none"
            className="h-12 border-2 border-line bg-bg px-3 font-mono text-base"
            placeholder="friend.testnet"
          />
        </label>
        {account && !accountOk && <ErrorText>That doesn't look like a NEAR account.</ErrorText>}
        <button className="pixel-btn" disabled={!accountOk || !labelOk || busy} onClick={() => void add()}>
          {busy ? "Saving..." : "Save the recipient"}
        </button>
      </Panel>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
