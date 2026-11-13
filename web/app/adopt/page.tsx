"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { FaucetPanel } from "@/components/wallet/FaucetPanel";
import { HatchAnimation } from "@/components/wallet/HatchAnimation";
import { MintForm } from "@/components/wallet/MintForm";
import { AppFrame, DemoSpeedPill, Panel } from "@/components/wallet/ui";
import { postHatch } from "@/lib/brain";
import { DEMO_PETS_CONTRACT, PETS_CONTRACT, petPath } from "@/lib/chain";
import { authHeaders } from "@/lib/session";

// /adopt (03 section 2): mint without a device, then go to the browser Petto.
export default function AdoptPage() {
  const router = useRouter();
  const [contract, setContract] = useState<string>(PETS_CONTRACT);
  const [minted, setMinted] = useState<string | null>(null);

  if (minted) {
    return (
      <AppFrame title="Hatching" demo={contract === DEMO_PETS_CONTRACT}>
        <HatchAnimation
          contract={contract}
          tokenId={minted}
          onDone={async () => {
            // Build Spec 1: the hatch the owner just watched is real; the pet shows as a baby from now on.
            // Signed out or brain down: the pet page offers "Hatch" again, so nothing is lost.
            await postHatch(`${contract}:${minted}`, authHeaders()).catch(() => undefined);
            router.push(petPath(contract, minted));
          }}
        />
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Hatch a pet" back="/">
      <Panel>
        <ConnectButton />
      </Panel>
      <FaucetPanel />
      <Panel>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-display text-sm">Speed</legend>
          <SpeedOption
            checked={contract === PETS_CONTRACT}
            onSelect={() => setContract(PETS_CONTRACT)}
            title="Normal"
            body="Real-time needs. Fuel lasts days."
          />
          <SpeedOption
            checked={contract === DEMO_PETS_CONTRACT}
            onSelect={() => setContract(DEMO_PETS_CONTRACT)}
            title="Demo speed"
            pill
            body="About 100 times faster. A new pet runs out of fuel in about 14 minutes."
          />
        </fieldset>
      </Panel>
      <Panel>
        <MintForm key={contract} contract={contract} onMinted={setMinted} />
      </Panel>
    </AppFrame>
  );
}

function SpeedOption({
  checked,
  onSelect,
  title,
  body,
  pill,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  pill?: boolean;
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
