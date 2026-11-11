import type { TimelineItem } from "@/lib/brain";

const YOCTO = 10n ** 24n;
const STAGE_NAMES = ["egg", "baby", "teen", "adult"];

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
    // the brain's snapshot diff has no payer, so a feed may have no actor
    case "fed": return `Fed${t.actor ? ` by ${t.actor}` : ""}${near ? ` (${near})` : ""}`;
    // soul_updated carries the version and stage_up the stage index in `amount`
    case "soul_updated": {
      const v = t.amount ?? t.detail?.replace(/^v/, "");
      return `Soul updated${v ? ` to v${v}` : ""}`;
    }
    case "stage_up": {
      const s = t.amount && /^\d$/.test(t.amount) ? STAGE_NAMES[Number(t.amount)] : t.amount ?? t.detail;
      return `Grew up${s ? ` to ${s}` : ""}`;
    }
    case "owner_changed": return `New owner${t.actor ? ` ${t.actor}` : ""}`;
    case "staked": return `${near ?? "NEAR"} planted in the Brain Garden`;
    case "unstaked": return `${near ?? "NEAR"} unplanted from the Brain Garden`;
    case "unstake_withdrawn": return `${near ?? "NEAR"} collected from the Brain Garden`;
    case "staked_from_food": return `${near ?? "NEAR"} of food planted in the Brain Garden`;
    case "credit_swept": return "Garden credit sent to the AI brain";
    case "thoughts_day": {
      // one row per UTC day: `count` thoughts, `amount` total micro-USD paid on chain
      const n = (t as { count?: number }).count ?? null;
      const usd = t.amount && /^\d+$/.test(t.amount) ? (Number(t.amount) / 1_000_000).toFixed(3) : null;
      return `${n ?? "Some"} thought${n === 1 ? "" : "s"} paid from its own budget${usd ? ` ($${usd})` : ""}`;
    }
    case "evolved": return "Grew wings";
    case "dormant": return "Fell into a deep sleep";
    case "revived": return "Woke up";
    case "hatched":
    case "minted": return `Hatched by ${who}`;
    default: return t.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}
