import type { VerifyStatus } from "@/lib/brain";

/** Badge words and colours (design.md section 5). Icon plus word, never colour alone. */
export const VERIFY_LABEL: Record<VerifyStatus, { word: string; icon: string; colour: string }> = {
  model_verified: { word: "Model verified", icon: "✓", colour: "text-fuel" },
  gateway_verified: { word: "Gateway verified", icon: "✓", colour: "text-[var(--n-gateway)]" },
  unverified: { word: "Unverified", icon: "!", colour: "text-warn" },
  pending: { word: "verifying", icon: "…", colour: "text-muted" },
};
