"use client";

import { WalletProvider } from "@/components/wallet/WalletProvider";

/** Client providers for every page: NEAR Connect wallet (testnet). The brain session lives in lib/session.ts. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
