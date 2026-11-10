import type { PetState } from "@nearling/shared";

const SEGMENTS = 10;

/** 10 pixel blocks driven by fuel left; colour by state (design.md section 5). */
export function FuelMeter({ fuel }: { fuel: PetState["fuel"] }) {
  // A full bar = 3 days of burn, like the contract's fullness.
  const fullBudget = Math.max(fuel.daily_burn_micro * 3, fuel.price_micro);
  const filled = Math.min(SEGMENTS, Math.ceil((fuel.budget_micro / fullBudget) * SEGMENTS));
  const colour = fuel.left === 0 ? "bg-danger" : fuel.low ? "bg-warn" : "bg-fuel";
  return (
    <div className="flex items-center gap-3" aria-label={`Fuel: ${fuel.left} thoughts left`}>
      <span className="font-display text-sm">Fuel</span>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={`h-4 w-3 border-2 border-line ${i < filled ? colour : "bg-surface"}`} />
        ))}
      </div>
      <span className="font-mono text-sm">{fuel.left} thoughts</span>
    </div>
  );
}
