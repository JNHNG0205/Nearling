import { EXPLORER_TX, shortHash, type Turn } from "@/lib/brain";
import css from "../nearling/nearling.module.css";

const SOURCE: Record<string, string> = {
  food: "paid from food",
  credit: "from Garden credit",
  mixed: "mixed",
};

/** "1 thought . charging..." then "paid . 8Fh2.." with an explorer link (TxStatus, design.md 5). */
export function FuelChip({ fuel }: { fuel: Turn["fuel"] }) {
  if (fuel.status === "none") return <span className={`${css.chip} text-muted`}>free</span>;
  if (fuel.status === "failed") return <span className={`${css.chip} text-warn`}>1 thought . charge retrying</span>;
  if (fuel.status === "pending" || !fuel.tx) {
    return <span className={`${css.chip} text-muted`}>1 thought . <span className="font-mono">charging...</span></span>;
  }
  return (
    <span className={`${css.chip} text-accent`}>
      1 thought . {fuel.source ? `${SOURCE[fuel.source] ?? fuel.source} . ` : ""}
      <a href={`${EXPLORER_TX}${fuel.tx}`} target="_blank" rel="noreferrer" className={`${css.txLink} font-mono`}
        aria-label={`Paid, transaction ${fuel.tx}`}>
        paid {shortHash(fuel.tx)}
      </a>
    </span>
  );
}
