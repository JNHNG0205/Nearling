import type { PetState } from "@nearling/shared";

const SEGMENTS = 10;

export function fuelSegments(fuel: PetState["fuel"]): number {
  // A full bar = 3 days of burn, like the contract's fullness.
  const fullBudget = Math.max(fuel.daily_burn_micro * 3, fuel.price_micro);
  if (fuel.budget_micro <= 0) return 0;
  return Math.min(SEGMENTS, Math.max(1, Math.ceil((fuel.budget_micro / fullBudget) * SEGMENTS)));
}

export const thoughts = (n: number) => `${n} ${n === 1 ? "thought" : "thoughts"}`;

/** 10 pixel blocks driven by fuel left; colour by state (design.md section 5). */
export function FuelMeter({ fuel, name = "the pet" }: { fuel: PetState["fuel"]; name?: string }) {
  const filled = fuelSegments(fuel);
  const colour = fuel.left === 0 ? "bg-danger" : fuel.low ? "bg-warn" : "bg-fuel";
  const usd = (fuel.price_micro / 1_000_000).toFixed(3);
  return (
    <div
      className="flex items-center gap-3"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={SEGMENTS}
      aria-valuenow={filled}
      aria-label={`Fuel: ${thoughts(fuel.left)} left`}
      title={`1 thought = 1 private AI reply = $${usd}, paid from ${name}'s own budget on NEAR.`}
    >
      <span className="font-display text-sm">Fuel</span>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={`h-4 w-3 border-2 border-line ${i < filled ? colour : "bg-surface"}`} />
        ))}
      </div>
      <span className="whitespace-nowrap font-mono text-sm">{thoughts(fuel.left)}</span>
    </div>
  );
}
