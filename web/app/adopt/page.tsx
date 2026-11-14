"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { FaucetPanel } from "@/components/wallet/FaucetPanel";
import { HatchAnimation } from "@/components/wallet/HatchAnimation";
import { MintForm } from "@/components/wallet/MintForm";
import { SpeedPicker } from "@/components/wallet/SpeedPicker";
import { AppFrame, Panel } from "@/components/wallet/ui";
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
        <SpeedPicker contract={contract} onChange={setContract} />
      </Panel>
      <Panel>
        <MintForm key={contract} contract={contract} onMinted={setMinted} />
      </Panel>
    </AppFrame>
  );
}

