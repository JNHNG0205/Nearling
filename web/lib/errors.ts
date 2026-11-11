// Error text for people: contract `E_` panics ("web-app architectual/02" section 3) and brain
// error codes (05 section 5). `name` replaces "Mochi" in the copy with the pet's name.

const CHAIN: Record<string, (name: string) => string> = {
  // money and amounts
  E_DEPOSIT: () => "The amount didn't match. Please try again.",
  E_GAS: () => "Not enough gas attached. Please retry.",
  E_STORAGE: () => "The mint price no longer covers storage. Please tell the Nearling team.",
  // naming and Soul
  E_NAME: () => "Names need 1 to 32 characters.",
  E_SOUL_SIZE: () => "The Soul is too long (1 KB max).",
  // who may call
  E_NOT_OWNER: (n) => `Only ${n}'s owner can do that.`,
  E_NOT_ADMIN: () => "Only the Nearling team can change this.",
  E_NOT_BRAIN: () => "Only the pet's brain can do that.",
  E_NOT_DEVICE: (n) => `This needs ${n}'s registered device.`,
  E_UNKNOWN_PET: () => "That pet doesn't exist on this contract.",
  // care
  E_COOLDOWN: (n) => `${n} needs a short break. Try again in a minute.`,
  E_ASLEEP: (n) => `${n} is asleep. Wake ${n} first.`,
  E_ITEM: () => "That item can't be added.",
  // Brain Garden (NEARON)
  E_MIN_STAKE: () => "Plant at least 1 NEAR in the Brain Garden.",
  E_POOL_NOT_READY: () => "The Brain Garden isn't open yet. Try later.",
  E_POOL_READY: () => "The Brain Garden is already open.",
  E_UNSTAKE_PENDING: () => "You already have NEAR on its way back.",
  E_LOCKED: () => "Still unlocking. Check back after the time shown.",
  E_NO_STAKE: () => "Nothing to unstake.",
  E_NO_UNSTAKE: () => "Nothing to withdraw.",
  E_FOOD_RESERVE: (n) => `${n} needs to keep a day of food. Try a smaller amount.`,
  E_DEVICE_CAP: () => "That is over the device limit. Approve it from the web instead.",
  E_CREDIT_CAP: () => "That correction is too large.",
  // transfer
  E_STAKED: (n) => `Take ${n}'s NEAR out of the Brain Garden before giving ${n} away.`,
  // on-chain approvals
  E_APPROVAL_MODE: (n) => `This needs approval on ${n}'s device first.`,
  E_EXPIRED: () => "This request expired. Start again.",
  E_SAME_KEY: () => "The key that asked can't also approve. Approve on the device.",
  E_NO_ACTION: () => "That request is gone. It was approved, cancelled or expired.",
  E_TOO_MANY_ACTIONS: () => "Too many requests are waiting. Approve or cancel one first.",
  // shirts
  E_CLAIMED: () => "You already have your Nearling shirt.",
};

const BRAIN: Record<string, (name: string) => string> = {
  rate_limited: (n) => `${n} is still thinking. One sec.`,
  brain_resting: (n) => `${n}'s brain is resting for today. Care still works.`,
  bad_audio: () => "I couldn't hear that. Try again a little closer.",
  not_owner: (n) => `Only ${n}'s owner can do that.`,
  unauthorized: () => "Sign in again to continue.",
  expired: () => "This code has expired.",
  not_found: () => "We couldn't find that.",
  conflict: () => "That was already done.",
  upstream: (n) => `${n}'s brain got tangled. Try again?`,
  invalid: () => "That didn't look right. Please check and retry.",
};

export const GENERIC_ERROR = "Something went wrong";
export const CANCELLED = "Cancelled";

/** First `E_CODE` found in a panic message or a serialised failure. */
export function chainErrorCode(text: string): string | null {
  const m = /\b(E_[A-Z_]+):/.exec(text) ?? /\b(E_[A-Z_]+)\b/.exec(text);
  return m ? m[1]! : null;
}

/** True when the person closed or rejected the wallet popup. */
export function isWalletRejection(err: unknown): boolean {
  const text = errorText(err).toLowerCase();
  return /user (rejected|cancel|closed|denied)|rejected by user|cancelled|canceled|popup closed|window closed|wallet closed/.test(
    text,
  );
}

export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return `${err.message} ${safeJson((err as { cause?: unknown }).cause)}`;
  return safeJson(err);
}

function safeJson(v: unknown): string {
  if (v == null) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function chainErrorCopy(code: string | null, name = "your pet"): string {
  const f = code ? CHAIN[code] : undefined;
  return f ? f(name) : GENERIC_ERROR;
}

export function brainErrorCopy(code: string, name = "your pet"): string {
  const f = BRAIN[code];
  return f ? f(name) : GENERIC_ERROR;
}

/** Friendly line for any failure text from a transaction. */
export function friendlyChainError(text: string, name?: string): { code: string | null; message: string } {
  const code = chainErrorCode(text);
  return { code, message: chainErrorCopy(code, name) };
}
