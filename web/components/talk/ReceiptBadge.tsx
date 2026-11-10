"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getReceipt, type VerifyStatus } from "@/lib/brain";
import { authHeaders } from "@/lib/session";
import css from "../nearling/nearling.module.css";
import { VERIFY_LABEL } from "./verifyLabel";

const POLL_MS = 3_000;
const POLL_MAX_MS = 30_000;

/**
 * Square chip under a reply (design.md section 5). While "verifying", polls the receipt
 * every 3 s for at most 30 s (04 section 4 step 5). Opens the receipt page.
 */
export function ReceiptBadge({ turnId, status }: { turnId: string; status: VerifyStatus }) {
  const [current, setCurrent] = useState<VerifyStatus>(status);

  useEffect(() => setCurrent(status), [status]);

  useEffect(() => {
    if (current !== "pending") return;
    const started = Date.now();
    let stopped = false;
    const timer = setInterval(async () => {
      if (Date.now() - started > POLL_MAX_MS) {
        clearInterval(timer);
        return;
      }
      try {
        const r = await getReceipt(turnId, { headers: authHeaders(), cache: "no-store" });
        if (!stopped && r.verification.status !== "pending") {
          setCurrent(r.verification.status);
          clearInterval(timer);
        }
      } catch {
        // not ready yet
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [turnId, current]);

  const v = VERIFY_LABEL[current];
  return (
    <Link href={`/receipt/${encodeURIComponent(turnId)}`} className={`${css.chip} ${v.colour}`}
      aria-label={`${v.word}. See the receipt`}>
      <span aria-hidden>{v.icon}</span>
      {v.word}
    </Link>
  );
}
