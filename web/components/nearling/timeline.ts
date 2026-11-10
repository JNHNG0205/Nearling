import type { TimelineItem } from "@/lib/brain";

const YOCTO = 10n ** 24n;

/** yoctoNEAR string to a short NEAR amount ("0.5", "12.345"). */
export function formatNear(yocto: string | null | undefined, decimals = 3): string {
  if (!yocto || !/^\d+$/.test(yocto)) return "0";
  const v = BigInt(yocto);
  const whole = v / YOCTO;
  const frac = ((v % YOCTO) * 10n ** BigInt(decimals)) / YOCTO;
  const f = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return f ? `${whole}.${f}` : whole.toString();
}

/** One line per chain or brain event on the public timeline. */
export function timelineLine(t: TimelineItem): string {
  const who = t.actor ?? "someone";
  const near = t.amount && /^\d{10,}$/.test(t.amount) ? `${formatNear(t.amount)} NEAR` : t.amount;
  switch (t.kind) {
    case "fed": return `Fed by ${who}${near ? ` (${near})` : ""}`;
    case "soul_updated": return `Soul updated${t.detail ? ` to ${t.detail}` : ""}`;
    case "stage_up": return `Grew up${t.detail ? ` to ${t.detail}` : ""}`;
    case "staked": return `${near ?? "NEAR"} planted in the Brain Garden`;
    case "unstaked": return `${near ?? "NEAR"} unplanted from the Brain Garden`;
    case "evolved": return "Grew wings";
    case "dormant": return "Fell into a deep sleep";
    case "revived": return "Woke up";
    case "hatched":
    case "minted": return `Hatched by ${who}`;
    default: return t.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}
