// Sign-in progress (login page, wallet button, /go): four steps on one pixel bar. Each step owns
// a quarter of the blocks and creeps through them while it runs, so the bar never looks stuck.

export type SignInStep = "open" | "check" | "sign" | "pets";

export const SIGN_IN_BLOCKS = 12;
const ORDER: SignInStep[] = ["open", "check", "sign", "pets"];
const LABEL: Record<SignInStep, string> = {
  open: "Opening sign-in...",
  check: "Checking your login...",
  sign: "Signing you in to Petto...",
  pets: "Finding your pets...",
};

export function signInProgress(step: SignInStep, elapsedMs: number): { step: number; filled: number; label: string } {
  const i = ORDER.indexOf(step);
  const per = SIGN_IN_BLOCKS / ORDER.length;
  const creep = Math.min(per - 1, Math.floor((per - 1) * (1 - Math.exp(-elapsedMs / 3_000)) + 0.5));
  return { step: i + 1, filled: i * per + 1 + creep, label: LABEL[step] };
}
