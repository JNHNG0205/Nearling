// /start guided setup: pure step logic (resume, skip, completion). The page keeps the
// state in localStorage under WIZARD_KEY and passes live facts (wallet, URL) in.

export const WIZARD_KEY = "nearling.start";

export type StepId = 1 | 2 | 3;
export const STEPS: { id: StepId; title: string }[] = [
  { id: 1, title: "Connect your wallet" },
  { id: 2, title: "Hatch and customise your pet" },
  { id: 3, title: "Connect your Petto or play in the browser" },
];

/** How the visitor reached a device: the QR link or Bluetooth (kept for the last step), or none. */
export type DeviceLink = "none" | "qr" | "ble" | "browser";

export interface WizardState {
  v: 1;
  device: DeviceLink;
  /** Pairing token from `/start?t=` or Bluetooth, so the last step can finish pairing with it. */
  pairingToken: string | null;
  /** Account the pet choice belongs to; another account resets step 2. */
  account: string | null;
  /** The owner pressed on from step 1 (after the faucet check) with this account. */
  walletConfirmed: boolean;
  petRef: string | null;
  customised: boolean;
}

export const EMPTY_WIZARD: WizardState = {
  v: 1, device: "none", pairingToken: null, account: null, walletConfirmed: false, petRef: null, customised: false,
};

const LINKS: DeviceLink[] = ["none", "qr", "ble", "browser"];
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Reads a stored state; anything missing or malformed falls back to the empty wizard. */
export function parseWizard(raw: string | null): WizardState {
  if (!raw) return EMPTY_WIZARD;
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_WIZARD;
    o = parsed as Record<string, unknown>;
  } catch {
    return EMPTY_WIZARD;
  }
  if (o.v !== 1) return EMPTY_WIZARD;
  const device = LINKS.includes(o.device as DeviceLink) ? (o.device as DeviceLink) : "none";
  return {
    v: 1,
    device,
    pairingToken: str(o.pairingToken),
    account: str(o.account),
    walletConfirmed: o.walletConfirmed === true,
    petRef: str(o.petRef),
    customised: o.customised === true,
  };
}

export interface WizardFacts {
  /** Connected wallet account (null while disconnected). */
  account: string | null;
  /** Wallet connected and the brain session signed for it. */
  signedIn: boolean;
  /** `t` from `/start?t=<token>`: the user arrived from the Petto's QR. */
  urlToken: string | null;
}

/** Folds live facts into the stored state: a QR token is kept for the device step, a new account starts again at step 1. */
export function applyFacts(s: WizardState, f: WizardFacts): WizardState {
  let next = s;
  if (f.urlToken && (s.device !== "qr" || s.pairingToken !== f.urlToken)) {
    next = { ...next, device: "qr", pairingToken: f.urlToken };
  }
  if (f.account && next.account !== f.account) {
    next = { ...next, account: f.account, walletConfirmed: false, petRef: null, customised: false };
  }
  return next;
}

export function stepDone(s: WizardState, f: WizardFacts, step: StepId): boolean {
  switch (step) {
    case 1:
      return f.signedIn && s.walletConfirmed && s.account === f.account;
    case 2:
      return stepDone(s, f, 1) && s.petRef !== null && s.customised;
    case 3:
      return false; // device or browser is where the wizard ends
  }
}

/** First step that is not done; this is where a returning visitor resumes. */
export function currentStep(s: WizardState, f: WizardFacts): StepId {
  return STEPS.find((st) => !stepDone(s, f, st.id))?.id ?? 3;
}

/** A step can be opened when it is done or is the current one (no jumping ahead). */
export function canOpen(s: WizardState, f: WizardFacts, step: StepId): boolean {
  return step <= currentStep(s, f);
}

/** Steps done out of the two that can be done, for the progress bar. */
export function progress(s: WizardState, f: WizardFacts): number {
  return STEPS.filter((st) => st.id !== 3 && stepDone(s, f, st.id)).length;
}
