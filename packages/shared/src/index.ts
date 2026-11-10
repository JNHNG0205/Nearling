// Types shared by brain and web. Chain shapes mirror docs/abi/nearling_pets_abi.json
// (frozen interface, docs/CONTRACT_INTERFACE.md). Brain shapes mirror
// "AI-brain architectual/08-api-reference.md".

// ---------- chain (pets contract) ----------

export type ChainLifeState = "Happy" | "Sad" | "Hungry" | "Sleepy" | "Starving" | "Dormant";

/** `get_pet` result. u128 / u64-timestamp fields are strings, micro-USD fields are numbers. */
export interface PetView {
  id: string;
  owner: string;
  name: string;
  born_at_ns: string;
  food_yocto: string;
  credit_micro: number;
  budget_micro: number;
  fullness: number;
  mood: number;
  energy: number;
  asleep_since_ns: string | null;
  xp: number;
  stage: number;
  traits: number[];
  starving_since_ns: string | null;
  life_state: ChainLifeState;
  staked: string;
  pending_unstake: { amount: string; unlock_epoch: string } | null;
  daily_credit_micro: number;
  daily_burn_micro: number;
  self_sustaining: boolean;
  items: number[];
  device_pk: string | null;
  approval_mode: boolean;
  soul_version: number;
}

export interface SoulView {
  version: number;
  prompt: string;
}

// ---------- pet reference ----------

/** `<contract>:<token_id>`, so one brain serves pets-v8 and pets-demo. */
export type PetRef = string;

export function formatPetRef(contract: string, tokenId: string): PetRef {
  return `${contract}:${tokenId}`;
}

export function parsePetRef(ref: string): { contract: string; tokenId: string } | null {
  const i = ref.lastIndexOf(":");
  if (i <= 0 || i === ref.length - 1) return null;
  const contract = ref.slice(0, i);
  const tokenId = ref.slice(i + 1);
  if (!/^\d+$/.test(tokenId)) return null;
  if (!/^[a-z0-9._-]+$/.test(contract)) return null;
  return { contract, tokenId };
}

// ---------- fuel and display state ----------

export const STAGES = ["egg", "baby", "teen", "adult"] as const;
export type Stage = (typeof STAGES)[number];

export type DisplayState = "happy" | "sad" | "hungry" | "sleepy" | "starving" | "dormant";

/** Fuel left = whole thoughts the budget can still pay for. */
export function fuelLeft(budgetMicro: number, fuelPriceMicro: number): number {
  if (fuelPriceMicro <= 0) return 0;
  return Math.floor(budgetMicro / fuelPriceMicro);
}

/**
 * Fuel states come from the chain; mood comes from device-local care
 * (hybrid scope: on-chain mood is not the demo path). See AI-brain 04 section 1.
 */
export function displayState(
  lifeState: ChainLifeState,
  careMood: number,
  sleepingLocally: boolean,
): DisplayState {
  if (lifeState === "Dormant") return "dormant";
  if (lifeState === "Starving") return "starving";
  if (lifeState === "Hungry") return "hungry";
  if (sleepingLocally) return "sleepy";
  if (careMood < 40) return "sad";
  return "happy";
}

// ---------- brain API ----------

export interface PetState {
  pet_ref: PetRef;
  contract: string;
  token_id: string;
  demo_speed: boolean;
  name: string;
  owner: string;
  stage: Stage;
  /** contract stage index 0..3 and the five traits; the sprite look derives from these */
  stage_index: number;
  traits: number[];
  form: "base" | "winged";
  display_state: DisplayState;
  chain_life_state: ChainLifeState;
  fuel: {
    left: number;
    price_micro: number;
    budget_micro: number;
    daily_burn_micro: number;
    low: boolean;
  };
  garden: {
    staked_yocto: string;
    credit_micro: number;
    daily_credit_micro: number;
    self_sustaining: boolean;
    pending_unstake: { amount: string; unlock_epoch: string } | null;
  };
  soul_version: number;
  equipped_shirt: string | null;
  care: { mood: number; milestones: { pat: boolean; rock: boolean; sleep: boolean } };
  device: { paired: boolean; last_seen_at: number | null };
  as_of: number;
}

export type Emotion = "happy" | "excited" | "sleepy" | "sad" | "hungry" | "curious" | "silly";

export interface TalkResponse {
  turn_id: string | null;
  status: "done" | "canned" | "failed";
  transcript?: string;
  reply: string;
  emotion: Emotion;
  fuel: { left: number; charged?: "pending" | "settled" };
  audio_url: string | null;
  receipt_url: string | null;
  soul_version?: number;
  feed_url?: string;
}

export type BrainErrorCode =
  | "unauthorized"
  | "not_owner"
  | "not_found"
  | "rate_limited"
  | "brain_resting"
  | "bad_audio"
  | "expired"
  | "conflict"
  | "upstream"
  | "invalid";

export interface BrainError {
  error: { code: BrainErrorCode; message: string; retry_after_s?: number };
}

// NEP-413 sign-in constants (brain and web must match).
export const NEP413_MESSAGE = "Sign in to Nearling";
export const NEP413_RECIPIENT = "nearling";
