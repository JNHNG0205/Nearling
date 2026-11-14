"use client";

import { DEMO_PETS_CONTRACT, PETS_CONTRACT } from "@/lib/chain";
import { DemoSpeedPill } from "./ui";

/** Normal or demo-speed pets contract, for minting on /adopt and /start. */
export function SpeedPicker({ contract, onChange }: { contract: string; onChange: (contract: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 font-display text-sm">Speed</legend>
      <SpeedOption checked={contract === PETS_CONTRACT} onSelect={() => onChange(PETS_CONTRACT)}
        title="Normal" body="Real-time needs. Fuel lasts days." />
      <SpeedOption checked={contract === DEMO_PETS_CONTRACT} onSelect={() => onChange(DEMO_PETS_CONTRACT)}
        title="Demo speed" pill body="About 100 times faster. A new pet runs out of fuel in about 14 minutes." />
    </fieldset>
  );
}

function SpeedOption({ checked, onSelect, title, body, pill }: {
  checked: boolean; onSelect: () => void; title: string; body: string; pill?: boolean;
}) {
  return (
    <label className={`flex cursor-pointer gap-3 border-2 p-3 ${checked ? "border-accent" : "border-line"}`}>
      <input type="radio" name="speed" checked={checked} onChange={onSelect} className="mt-1 accent-[var(--p-accent)]" />
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2 font-display">
          {title} {pill && <DemoSpeedPill />}
        </span>
        <span className="text-sm text-muted">{body}</span>
      </span>
    </label>
  );
}
