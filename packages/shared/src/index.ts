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
  /** `deposit` (pets-v9): NEARON unstake deposit, paid back with the withdrawal */
  pending_unstake: { amount: string; unlock_epoch: string; deposit?: string } | null;
  daily_credit_micro: number;
  daily_burn_micro: number;
  self_sustaining: boolean;
  /** pets-v9: NEAR the owner stocked for the device to feed from. Absent on pets-v8. */
  pantry_yocto?: string;
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
  /**
   * Shown stage index 0..3 (what sprites draw): the contract stage, except a hatched egg shows
   * as a baby (Build Spec 1). The sprite look also derives from the five traits.
   */
  stage_index: number;
  /** the contract's own stage (0 egg until 10 xp from on-chain chats and check-ins) */
  chain_stage_index: number;
  /** true once hatched off chain (adopt, pairing, hatch button) or grown on chain */
  hatched: boolean;
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
    pending_unstake: { amount: string; unlock_epoch: string; deposit?: string } | null;
    /** pets-v9 pantry in yocto; "0" on contracts without a pantry */
    pantry_yocto: string;
    /** pets-v9 `config.pool_unstake_deposit` (yocto) attached to `unstake`; null on contracts without it */
    pool_unstake_deposit: string | null;
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

/** `GET /pets/:petRef/inbox` item (AI-brain architectual/08). */
export interface InboxItem {
  id: number;
  /** e.g. `fuel_low`, `morning`, `fed`; billed triggers that fell back to a canned line end in `:canned` in the DB, shown here without it */
  trigger: string;
  /** true when no inference produced the text (free) */
  canned: boolean;
  text: string;
  turn_id: string | null;
  created_at: number;
  delivered_device_at: number | null;
  read_at: number | null;
}

export type TimelineKind =
  | "minted"
  | "fed"
  | "thoughts_day"
  | "staked"
  | "staked_from_food"
  | "unstaked"
  | "unstake_withdrawn"
  | "soul_updated"
  | "stage_up"
  | "owner_changed"
  | "dormant"
  | "revived"
  | "credit_swept";

/** `GET /pets/:petRef/timeline` item (AI-brain architectual/08). */
export interface TimelineItem {
  id: number;
  kind: TimelineKind;
  actor: string | null;
  /**
   * yocto for fed / staked / staked_from_food / unstaked / unstake_withdrawn, new version for
   * soul_updated, new stage index for stage_up, total micro-USD for thoughts_day
   */
  amount: string | null;
  /** null only on snapshot rows */
  tx_hash: string | null;
  /** ms; block time for event rows, detection time for snapshot rows, newest thought for thoughts_day */
  at: number;
  /** "event": a contract EVENT_JSON log; "snapshot": get_pet diff, used only while the indexer fails */
  source: "event" | "snapshot";
  /** thoughts_day only: number of thoughts that UTC day and the day itself (YYYY-MM-DD) */
  count?: number;
  day?: string;
}

/** `GET /receipts/:turnId` (AI-brain architectual/03 section 7). */
export interface Receipt {
  turn_id: string;
  pet_ref: string;
  at: number | null;
  soul_version: number | null;
  model: string | null;
  verification: {
    status: string;
    signature_kind: string | null;
    signer: string | null;
    req_hash: string | null;
    resp_hash: string | null;
    reason: string | null;
    public: boolean;
    attestation: { id: string; fetched_at: number; nras: "pass" | "fail" | null; tdx: string; nras_jwt_signature: string } | null;
  };
  fuel: { cost_micro: number | null; source: string | null; tx: string | null; status: string | null } | null;
  provider_cost_usd: number | null;
  voice: { provider: string; note: string } | null;
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
