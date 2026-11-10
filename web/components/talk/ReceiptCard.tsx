import Link from "next/link";
import type { ReactNode } from "react";
import { EXPLORER_TX, shortHash, type Receipt, type VerifyStatus } from "@/lib/brain";
import { receiptChecks, type Check } from "./receiptChecks";
import { VERIFY_LABEL } from "./verifyLabel";
import css from "../nearling/nearling.module.css";

export function VerifyChip({ status }: { status: VerifyStatus }) {
  const v = VERIFY_LABEL[status];
  return (
    <span className={`${css.chip} ${v.colour}`}>
      <span aria-hidden>{v.icon}</span>
      {v.word}
    </span>
  );
}

const MARK: Record<Check["state"], { mark: string; colour: string; word: string }> = {
  ok: { mark: "[ok]", colour: "text-fuel", word: "passed" },
  fail: { mark: "[!!]", colour: "text-warn", word: "failed" },
  not_checked: { mark: "[--]", colour: "text-muted", word: "not checked" },
};

const SOURCE: Record<string, string> = { food: "paid from food", credit: "paid from Garden credit", mixed: "mixed food and credit" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 border-t-2 border-line py-2">
      <dt className="font-display text-sm text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The reply receipt (design.md 6.2). `sample` marks example data on the landing page. */
export function ReceiptCard({ receipt, footer, sample }: { receipt: Receipt; footer?: ReactNode; sample?: boolean }) {
  const checks = receiptChecks(receipt);
  const fuel = receipt.fuel;
  const ref = encodeURIComponent(receipt.pet_ref);
  return (
    <article className="pixel-panel flex flex-col gap-3 p-4" aria-label={sample ? "Sample receipt" : "Reply receipt"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl">{sample ? "Sample receipt" : "Reply receipt"}</h2>
        <VerifyChip status={receipt.verification.status} />
      </div>
      {receipt.verification.status === "unverified" && receipt.verification.reason && (
        <p className="text-warn"><span aria-hidden>! </span>Unverified: {receipt.verification.reason}</p>
      )}
      <dl>
        <Row label="Soul">
          {(receipt.soul_version ?? 0) > 0 ? (
            <>
              <span className="font-mono">v{receipt.soul_version}</span>{" "}
              {!sample && <Link href={`/pet/${ref}/soul`} className="text-accent underline underline-offset-4">View the Soul</Link>}
            </>
          ) : "Default personality (no Soul set)"}
        </Row>
        <Row label="Model">{receipt.model ? <><span className="font-mono">{receipt.model}</span> (private, runs in a TEE)</> : "Not recorded"}</Row>
        <Row label="Checks">
          <ul className="flex flex-col gap-1">
            {checks.map((c) => (
              <li key={c.text} className="flex gap-2">
                <span className={`font-mono ${MARK[c.state].colour}`} aria-label={MARK[c.state].word}>{MARK[c.state].mark}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </Row>
        <Row label="Fuel">
          <span className="font-mono">
            1 thought
            {fuel?.source ? ` . ${SOURCE[fuel.source] ?? fuel.source}` : ""}
            {fuel?.tx ? (
              sample ? ` . tx ${shortHash(fuel.tx)}` : (
                <> . <a className={`${css.txLink} text-accent`} href={`${EXPLORER_TX}${fuel.tx}`} target="_blank" rel="noreferrer">tx {shortHash(fuel.tx)}</a></>
              )
            ) : " . charging"}
          </span>
        </Row>
        <Row label="Voice">
          {receipt.voice?.provider && receipt.voice.provider !== "none"
            ? `${voiceName(receipt.voice.provider)} (${receipt.voice.note ?? "reply text sent to a third-party voice service"})`
            : "No voice for this reply. The text stayed with the brain."}
        </Row>
        {receipt.at != null && (
          <Row label="When"><span className="font-mono">{new Date(receipt.at).toISOString().replace("T", " ").slice(0, 16)} UTC</span></Row>
        )}
      </dl>
      {footer}
    </article>
  );
}

const voiceName = (p: string) => (p === "elevenlabs" ? "ElevenLabs" : p === "kokoro" ? "Kokoro (self-hosted)" : p);
