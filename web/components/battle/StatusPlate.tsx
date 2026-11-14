import type { Fighter } from "@petto/battle";

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 font-display text-xs">{label}</span>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-3 flex-1 border-2 border-[var(--n-line)] bg-bg"
      >
        <div className="h-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-14 text-right font-mono text-xs tabular-nums">{value}/{max}</span>
    </div>
  );
}

/** Name, level, HP and MP of one fighter. HP turns orange under half and red under a fifth. */
export function StatusPlate({ name, fighter }: { name: string; fighter: Fighter }) {
  const { hp, mp, stats } = fighter;
  const hpColor = hp * 5 <= stats.hp ? "var(--n-danger)" : hp * 2 <= stats.hp ? "var(--n-warn)" : "var(--n-fuel)";
  return (
    <div className="pixel-panel flex w-full flex-col gap-1 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-display text-sm">{name}</span>
        <span className="font-display text-xs text-muted">Lv {fighter.level}</span>
      </div>
      <Bar label="HP" value={hp} max={stats.hp} color={hpColor} />
      <Bar label="MP" value={mp} max={stats.mp} color="var(--n-gateway)" />
    </div>
  );
}
