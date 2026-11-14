// Device signing reference (docs/hardware/DEVICE_SIGNING.md). The ESP32 firmware must produce the
// same bytes as this file; vectors/*.json pin them. Testnet only (CLAUDE.md rule 2).
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";
import { PublicKey, actions, createTransaction, encodeTransaction } from "near-api-js";

export * from "./ble";

export const TGAS = 1_000_000_000_000n;
/** Gas the device attaches: approvals may run a 400 Tgas NEARON call plus callback (CLAUDE.md 7.3). */
export const DEVICE_GAS = { play: 30n * TGAS, feed_from_pantry: 30n * TGAS, stake_from_food: 450n * TGAS, approve_action: 450n * TGAS } as const;
/** Methods the device's function-call key may call (receiver = pets contract). */
export const DEVICE_METHODS = ["play", "stake_from_food", "feed_from_pantry", "approve_action"] as const;
export type DeviceMethod = (typeof DEVICE_METHODS)[number];

export interface DeviceKey {
  /** `ed25519:<base58 of 32-byte public key>` */
  publicKey: string;
  /** NEAR format `ed25519:<base58 of 64 bytes = seed || public key>`. Secret: keep in device storage only. */
  secretKey: string;
}

/** Ed25519 key for a device. Random unless a 32-byte seed is given (tests and vectors only). */
export function deviceKey(seed?: Uint8Array): DeviceKey {
  const sk = seed ?? ed25519.utils.randomSecretKey();
  if (sk.length !== 32) throw new Error("seed must be 32 bytes");
  const pk = ed25519.getPublicKey(sk);
  const full = new Uint8Array(64);
  full.set(sk, 0);
  full.set(pk, 32);
  return { publicKey: `ed25519:${base58.encode(pk)}`, secretKey: `ed25519:${base58.encode(full)}` };
}

/** 32-byte seed from a NEAR `ed25519:` secret key (64-byte seed || pk, or a bare 32-byte seed). */
export function seedOf(secretKey: string): Uint8Array {
  const raw = base58.decode(secretKey.replace(/^ed25519:/, ""));
  if (raw.length !== 64 && raw.length !== 32) throw new Error("not an ed25519 secret key");
  return raw.slice(0, 32);
}

export function publicKeyOf(secretKey: string): string {
  return `ed25519:${base58.encode(ed25519.getPublicKey(seedOf(secretKey)))}`;
}

export interface FunctionCallTx {
  signerId: string;
  /** `ed25519:<base58>` */
  publicKey: string;
  /** access key nonce + 1 (or any larger value) */
  nonce: bigint | number | string;
  receiverId: string;
  /** base58 block hash (`block_hash` from view_access_key) or its 32 raw bytes */
  blockHash: string | Uint8Array;
  methodName: string;
  /** object (JSON.stringify'd, key order as given) or exact bytes */
  args: object | Uint8Array;
  gas: bigint;
  /** function-call keys cannot attach NEAR: must be 0 */
  deposit?: 0n | 0;
}

/** JSON args bytes exactly as signed (JSON.stringify, no spaces, key order kept). */
export function argsBytes(args: object | Uint8Array): Uint8Array {
  return args instanceof Uint8Array ? args : new TextEncoder().encode(JSON.stringify(args));
}

/** Borsh bytes of a Transaction (V0) with one FunctionCall action. */
export function buildFunctionCallTx(p: FunctionCallTx): Uint8Array {
  if (p.deposit !== undefined && BigInt(p.deposit) !== 0n) throw new Error("device transactions carry no deposit");
  const hash = typeof p.blockHash === "string" ? base58.decode(p.blockHash) : p.blockHash;
  if (hash.length !== 32) throw new Error("block hash must be 32 bytes");
  const tx = createTransaction(
    p.signerId,
    PublicKey.fromString(p.publicKey),
    p.receiverId,
    BigInt(p.nonce),
    [actions.functionCall(p.methodName, argsBytes(p.args), p.gas, 0n)],
    hash,
  );
  return new Uint8Array(encodeTransaction(tx));
}

/** sha256 of the transaction bytes: the message that is signed, and (base58) the tx hash. */
export function txDigest(txBytes: Uint8Array): Uint8Array {
  return sha256(txBytes);
}

export function txHashOf(txBytes: Uint8Array): string {
  return base58.encode(txDigest(txBytes));
}

/** 64-byte ed25519 signature over sha256(txBytes). */
export function signTx(txBytes: Uint8Array, secretKey: string): Uint8Array {
  return ed25519.sign(txDigest(txBytes), seedOf(secretKey));
}

/** Borsh SignedTransaction = Transaction bytes || Signature { key_type: u8 = 0, data: [u8; 64] }. */
export function signedTxBytes(txBytes: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new Error("signature must be 64 bytes");
  const out = new Uint8Array(txBytes.length + 65);
  out.set(txBytes, 0);
  out[txBytes.length] = 0; // KeyType::ED25519
  out.set(signature, txBytes.length + 1);
  return out;
}

export function signedTxBase64(p: FunctionCallTx, secretKey: string): string {
  const tx = buildFunctionCallTx(p);
  return base64.encode(signedTxBytes(tx, signTx(tx, secretKey)));
}

// ---------- RPC ----------

export class RpcError extends Error {
  constructor(message: string, public data?: unknown) {
    super(message);
  }
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "petto-device", method, params }),
  });
  const body = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string; data?: unknown; cause?: unknown } } | null;
  if (!body) throw new RpcError(`RPC HTTP ${res.status}`);
  if (body.error) throw new RpcError(body.error.message ?? "RPC error", body.error.cause ?? body.error.data);
  if (body.result && typeof body.result === "object" && "error" in (body.result as object)) {
    throw new RpcError(String((body.result as unknown as { error: unknown }).error));
  }
  return body.result as T;
}

export interface AccessKeyView {
  nonce: number;
  block_hash: string;
  permission: unknown;
}

/** `query view_access_key` at final: gives the nonce and a recent block hash in one call. */
export function viewAccessKey(rpcUrl: string, accountId: string, publicKey: string): Promise<AccessKeyView> {
  return rpc<AccessKeyView>(rpcUrl, "query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: accountId,
    public_key: publicKey,
  });
}

export interface DeviceCall {
  /** the pet owner's account (the device key lives on it) */
  signerId: string;
  secretKey: string;
  receiverId: string;
  methodName: string;
  args: object;
  gas: bigint;
}

export interface DeviceTxResult {
  txHash: string;
  /** decoded `SuccessValue` (JSON if possible), when the tx succeeded */
  value: unknown;
  /** `Failure` from the final outcome, e.g. a contract panic `E_NOT_DEVICE: ...` */
  failure: unknown;
  outcome: unknown;
}

/** Full device flow: view_access_key, build, sign, send_tx (waits until executed). */
export async function sendDeviceTx(rpcUrl: string, call: DeviceCall): Promise<DeviceTxResult> {
  const publicKey = publicKeyOf(call.secretKey);
  const key = await viewAccessKey(rpcUrl, call.signerId, publicKey);
  const tx = buildFunctionCallTx({
    signerId: call.signerId,
    publicKey,
    nonce: BigInt(key.nonce) + 1n,
    receiverId: call.receiverId,
    blockHash: key.block_hash,
    methodName: call.methodName,
    args: call.args,
    gas: call.gas,
  });
  const signed = base64.encode(signedTxBytes(tx, signTx(tx, call.secretKey)));
  const txHash = txHashOf(tx);
  const outcome = await rpc<{ status?: { SuccessValue?: string; Failure?: unknown } }>(rpcUrl, "send_tx", {
    signed_tx_base64: signed,
    wait_until: "EXECUTED_OPTIMISTIC",
  });
  const status = outcome?.status ?? {};
  let value: unknown = null;
  if (typeof status.SuccessValue === "string" && status.SuccessValue) {
    const text = new TextDecoder().decode(base64.decode(status.SuccessValue));
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { txHash, value, failure: status.Failure ?? null, outcome };
}

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
