// Chain access for the web: contract ids, view helpers, transaction builders and outcome parsing.
// Deposits and gas follow docs/CONTRACT_INTERFACE.md. Pure module (no React), safe on the server.
import { JsonRpcProvider, nearToYocto, yoctoToNear } from "near-api-js";
import { formatPetRef, parsePetRef, type ContractAction, type PendingAction, type PetView, type SoulView } from "@nearling/shared";

// ---------- ids ----------

export const NETWORK = "testnet" as const;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://test.rpc.fastnear.com";
export const PETS_CONTRACT = process.env.NEXT_PUBLIC_PETS_CONTRACT ?? "pets-v9.nearling.testnet";
export const DEMO_PETS_CONTRACT = process.env.NEXT_PUBLIC_DEMO_PETS_CONTRACT ?? "pets-demo-v9.nearling.testnet";
export const SHIRTS_CONTRACT = process.env.NEXT_PUBLIC_SHIRTS_CONTRACT ?? "shirts.nearling.testnet";
export const EXPLORER_TX = "https://testnet.nearblocks.io/txns/";

export const PET_CONTRACTS = [PETS_CONTRACT, DEMO_PETS_CONTRACT] as const;

export function isPetContract(id: string): boolean {
  return (PET_CONTRACTS as readonly string[]).includes(id);
}

export function isDemoContract(id: string): boolean {
  return id === DEMO_PETS_CONTRACT;
}

/** Parses a URL `petRef` segment (URL-encoded `contract:token_id`), only for our two pets contracts. */
export function petFromRef(raw: string): { contract: string; tokenId: string; ref: string } | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const p = parsePetRef(decoded);
  if (!p || !isPetContract(p.contract)) return null;
  return { ...p, ref: formatPetRef(p.contract, p.tokenId) };
}

export function petPath(contract: string, tokenId: string, sub = ""): string {
  return `/pet/${encodeURIComponent(formatPetRef(contract, tokenId))}${sub}`;
}

// ---------- units ----------

export const TGAS = 1_000_000_000_000n;
export const GAS = {
  mint: 50n * TGAS,
  soul: 30n * TGAS,
  feed: 30n * TGAS,
  garden: 450n * TGAS, // stake, unstake, withdraw: NEARON call + callback (S6)
  claimShirt: 30n * TGAS,
  nftTransfer: 30n * TGAS,
  validatorStake: 100n * TGAS,
  pantry: 30n * TGAS, // stock_pantry, feed_from_pantry, empty_pantry (pets-v9)
  device: 30n * TGAS, // register_device, set_approval_mode, propose_action, cancel_action (CLAUDE.md 7.3)
  approve: 450n * TGAS, // approve_action running a NEARON call + callback (device signs it, S6)
} as const;

/** Methods of the device's limited access key (CLAUDE.md 7.2); pets-v9 adds `feed_from_pantry`. */
export const DEVICE_KEY_METHODS = ["play", "stake_from_food", "approve_action"] as const;
export const DEVICE_KEY_ALLOWANCE = nearToYocto("1");

export const ONE_YOCTO = 1n;
export const SHIRT_DEPOSIT = nearToYocto("0.01");
export const MIN_STAKE = nearToYocto("1");
export const SOUL_MAX_BYTES = 1024;

export function soulBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** "1.25" style NEAR string from yocto, trimmed. */
export function formatNear(yocto: string | bigint, decimals = 4): string {
  const s = yoctoToNear(BigInt(yocto), decimals);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Whole thoughts an amount of NEAR buys: yocto x near_usd_rate / fuel_price (pantry estimate). */
export function nearToThoughts(yocto: string | bigint, nearUsdRateMicro: number, fuelPriceMicro: number): number {
  if (fuelPriceMicro <= 0 || nearUsdRateMicro <= 0) return 0;
  return Number((BigInt(yocto) * BigInt(nearUsdRateMicro)) / (10n ** 24n * BigInt(fuelPriceMicro)));
}

/** Parses a user-typed NEAR amount ("1", "0.5"). Null when invalid or not positive. */
export function parseNear(input: string): bigint | null {
  const t = input.trim();
  if (!/^\d+(\.\d{1,24})?$/.test(t)) return null;
  try {
    const y = nearToYocto(t as `${number}`);
    return y > 0n ? y : null;
  } catch {
    return null;
  }
}

// ---------- views ----------

let provider: JsonRpcProvider | null = null;
function rpc(): JsonRpcProvider {
  provider ??= new JsonRpcProvider({ url: RPC_URL });
  return provider;
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  // near-api-js returns the JSON-decoded return value
  return (await rpc().callFunction({ contractId, method, args })) as T;
}

export interface PetsConfig {
  mint_storage: string;
  starter_food: string;
  min_stake: string;
  fuel_price_micro: number;
  near_usd_rate_micro: number;
  farm_rate_micro_per_near_day: number;
  demo_speed: boolean;
  /** pets-v9: NEARON's unstake deposit, attached to `unstake` and returned with the withdrawal. Absent on pets-v8. */
  pool_unstake_deposit?: string;
  /** pets-v9: most pantry NEAR the device key may move into food per UTC day. Absent on pets-v8. */
  device_feed_max_per_day?: string;
}

const configCache = new Map<string, Promise<PetsConfig>>();
export function getConfig(contract: string): Promise<PetsConfig> {
  let hit = configCache.get(contract);
  if (!hit) {
    hit = view<PetsConfig>(contract, "config");
    hit.catch(() => configCache.delete(contract));
    configCache.set(contract, hit);
  }
  return hit;
}

/** Mint price = config.mint_storage + config.starter_food (0.2 NEAR on pets-v8, 0.105 on pets-demo). */
export async function getMintPrice(contract: string): Promise<bigint> {
  const c = await getConfig(contract);
  return BigInt(c.mint_storage) + BigInt(c.starter_food);
}

export function getPet(contract: string, tokenId: string): Promise<PetView> {
  return view<PetView>(contract, "get_pet", { pet_id: tokenId });
}

/** pets-v9 has the device pantry (`feed_from_pantry`): its `get_pet` shows `pantry_yocto`. */
export function hasPantry(pet: PetView): boolean {
  return pet.pantry_yocto !== undefined;
}

/** On-chain actions waiting for the device's approval (CLAUDE.md 7.3). */
export function getPendingActions(contract: string, tokenId: string): Promise<PendingAction[]> {
  return view<PendingAction[]>(contract, "get_pending_actions", { pet_id: tokenId });
}

export function getSoul(contract: string, tokenId: string): Promise<SoulView> {
  return view<SoulView>(contract, "get_soul", { pet_id: tokenId });
}

export interface NftToken {
  token_id: string;
  owner_id: string;
  metadata?: { title?: string | null } | null;
}

export function nftTokensForOwner(contract: string, accountId: string): Promise<NftToken[]> {
  return view<NftToken[]>(contract, "nft_tokens_for_owner", { account_id: accountId, from_index: "0", limit: 50 });
}

/** NEAR account id rules (2 to 64 chars, lowercase parts joined by `.`, `-` or `_`). */
export function isAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}

/** True when the account exists on testnet (an NFT sent to a missing account is lost). */
export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await rpc().viewAccount({ accountId });
    return true;
  } catch (err) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(err))) return false;
    throw err;
  }
}

/** Account balance in yocto (`view_account` amount); 0 for an account that does not exist yet. */
export async function accountBalance(accountId: string): Promise<bigint> {
  try {
    return BigInt((await rpc().viewAccount({ accountId })).amount);
  } catch (err) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(err))) return 0n;
    throw err;
  }
}

/** Current epoch height (garden unlock check). */
export async function currentEpoch(): Promise<bigint> {
  const v = await rpc().viewValidators();
  return BigInt(v.epoch_height);
}

// ---------- transactions ----------

/** NEAR Connect action shape (accepted by every wallet in the manifest). */
export type TxAction =
  | { type: "FunctionCall"; params: { methodName: string; args: object; gas: string; deposit: string } }
  | { type: "Transfer"; params: { deposit: string } }
  | {
      type: "AddKey";
      params: {
        publicKey: string;
        accessKey: { permission: { receiverId: string; allowance: string; methodNames: string[] } };
      };
    }
  | { type: "DeleteKey"; params: { publicKey: string } };

export interface TxRequest {
  receiverId: string;
  actions: TxAction[];
}

function call(receiverId: string, methodName: string, args: object, gas: bigint, deposit: bigint = 0n): TxRequest {
  return {
    receiverId,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas: gas.toString(), deposit: deposit.toString() } }],
  };
}

export const tx = {
  mintPet: (contract: string, name: string, soul: string | null, price: bigint) =>
    call(contract, "nft_mint_pet", soul ? { name, soul } : { name }, GAS.mint, price),
  setSoul: (contract: string, petId: string, prompt: string) =>
    call(contract, "set_soul", { pet_id: petId, prompt }, GAS.soul),
  feed: (contract: string, petId: string, amount: bigint) => call(contract, "feed", { pet_id: petId }, GAS.feed, amount),
  stake: (contract: string, petId: string, amount: bigint) =>
    call(contract, "stake", { pet_id: petId }, GAS.garden, amount),
  /** `deposit` = config.pool_unstake_deposit on pets-v9 (payable unstake); 0 on pets-v8. */
  unstake: (contract: string, petId: string, amount: bigint, deposit: bigint = 0n) =>
    call(contract, "unstake", { pet_id: petId, amount: amount.toString() }, GAS.garden, deposit),
  withdraw: (contract: string, petId: string) => call(contract, "withdraw", { pet_id: petId }, GAS.garden),
  // pets-v9 pantry (docs/CONTRACT_CHANGES_V9.md section 3)
  stockPantry: (contract: string, petId: string, amount: bigint) =>
    call(contract, "stock_pantry", { pet_id: petId }, GAS.pantry, amount),
  feedFromPantry: (contract: string, petId: string, amount: bigint) =>
    call(contract, "feed_from_pantry", { pet_id: petId, amount: amount.toString() }, GAS.pantry),
  emptyPantry: (contract: string, petId: string, amount: bigint) =>
    call(contract, "empty_pantry", { pet_id: petId, amount: amount.toString() }, GAS.pantry),
  claimShirt: () => call(SHIRTS_CONTRACT, "claim", {}, GAS.claimShirt, SHIRT_DEPOSIT),
  nftTransfer: (contract: string, receiverId: string, tokenId: string) =>
    call(contract, "nft_transfer", { receiver_id: receiverId, token_id: tokenId }, GAS.nftTransfer, ONE_YOCTO),
  transfer: (receiverId: string, amount: bigint): TxRequest => ({
    receiverId,
    actions: [{ type: "Transfer", params: { deposit: amount.toString() } }],
  }),
  validatorStake: (pool: string, amount: bigint) => call(pool, "deposit_and_stake", {}, GAS.validatorStake, amount),

  // ---- device key and approvals (CLAUDE.md 7.2, 7.3) ----

  /** On the owner's own account: a limited key the device signs with (receiver = pets contract, 1 NEAR gas allowance). */
  addDeviceKey: (ownerId: string, contract: string, publicKey: string, pantry: boolean): TxRequest => ({
    receiverId: ownerId,
    actions: [
      {
        type: "AddKey",
        params: {
          publicKey,
          accessKey: {
            permission: {
              receiverId: contract,
              allowance: DEVICE_KEY_ALLOWANCE.toString(),
              methodNames: pantry ? [...DEVICE_KEY_METHODS, "feed_from_pantry"] : [...DEVICE_KEY_METHODS],
            },
          },
        },
      },
    ],
  }),
  deleteKey: (ownerId: string, publicKey: string): TxRequest => ({
    receiverId: ownerId,
    actions: [{ type: "DeleteKey", params: { publicKey } }],
  }),
  registerDevice: (contract: string, petId: string, publicKey: string) =>
    call(contract, "register_device", { pet_id: petId, public_key: publicKey }, GAS.device),
  /** Turning on runs directly; turning off is gated, so use `proposeAction(SetApprovalMode{on:false})`. */
  setApprovalMode: (contract: string, petId: string, on: boolean) =>
    call(contract, "set_approval_mode", { pet_id: petId, on }, GAS.device),
  /** `deposit`: exactly the amount for Stake, the pool unstake deposit for Unstake on pets-v9, else 0. */
  proposeAction: (contract: string, petId: string, action: ContractAction, deposit: bigint = 0n) =>
    call(contract, "propose_action", { pet_id: petId, action }, GAS.device, deposit),
  cancelAction: (contract: string, actionId: string) => call(contract, "cancel_action", { action_id: actionId }, GAS.device),
};

// ---------- outcome parsing ----------

/** The parts of a FinalExecutionOutcome we read (wallets return the RPC shape). */
export interface Outcome {
  status?: unknown;
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string; outcome?: { logs?: string[] } };
  receipts_outcome?: Array<{ id?: string; outcome?: { logs?: string[]; status?: unknown } }>;
}

export interface ChainEvent {
  standard: string;
  version: string;
  event: string;
  data: unknown;
}

export function txHash(o: Outcome): string | null {
  return o.transaction?.hash ?? o.transaction_outcome?.id ?? null;
}

/** All NEP-297 `EVENT_JSON:` events in the outcome, in log order. */
export function parseEvents(o: Outcome): ChainEvent[] {
  const logs = [
    ...(o.transaction_outcome?.outcome?.logs ?? []),
    ...(o.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? []),
  ];
  const out: ChainEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(line.slice("EVENT_JSON:".length)) as ChainEvent;
      if (e && typeof e.event === "string") out.push(e);
    } catch {
      // not an event
    }
  }
  return out;
}

/** Data entries of one event kind (each event's `data` is an array per NEP-297). */
export function eventData<T = Record<string, unknown>>(events: ChainEvent[], name: string): T[] {
  return events
    .filter((e) => e.event === name)
    .flatMap((e) => (Array.isArray(e.data) ? (e.data as T[]) : [e.data as T]));
}

/** Top-level failure of the transaction, as text, or null when it succeeded. */
export function outcomeFailure(o: Outcome): string | null {
  const s = o.status as { Failure?: unknown } | string | undefined;
  if (s && typeof s === "object" && "Failure" in s) return JSON.stringify(s.Failure);
  return null;
}

/** Decoded `SuccessValue` of the transaction (e.g. the minted token id). */
export function returnValue<T>(o: Outcome): T | null {
  const s = o.status as { SuccessValue?: string } | undefined;
  if (!s || typeof s !== "object" || typeof s.SuccessValue !== "string" || s.SuccessValue === "") return null;
  try {
    const bytes = Uint8Array.from(atob(s.SuccessValue), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}
