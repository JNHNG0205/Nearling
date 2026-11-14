import { PixelIcon, type IconName } from "@/components/PixelIcon";
import type { MenuOption } from "@/lib/battle";

const ICON: Record<string, IconName> = { fight: "attack", defend: "defence", dodge: "dodge", run: "speed" };

/** The command buttons: Fight / Run, or Attack, the pet's skills and Back. Locked skills say why. */
export function BattleMenu({ options, onPick }: { options: MenuOption[]; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={o.disabled}
          onClick={() => onPick(o.id)}
          className={`pixel-btn flex min-h-12 flex-col items-start gap-0.5 text-left ${o.id === "back" || o.id === "run" ? "pixel-btn--secondary" : ""}`}
        >
          <span className="flex items-center gap-2">{ICON[o.id] && <PixelIcon name={ICON[o.id]!} size={14} />}{o.label}</span>
          {(o.reason || o.mp) && <span className="text-xs opacity-80">{o.reason ?? `${o.mp} MP`}</span>}
        </button>
      ))}
    </div>
  );
}
