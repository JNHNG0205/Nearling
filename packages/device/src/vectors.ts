// Golden vectors for the firmware (docs/hardware/DEVICE_SIGNING.md section 6).
// TEST-ONLY THROWAWAY KEY: this seed is public in the repo. It is not registered on any account
// and must never be used for a real device or added to any NEAR account.
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";
import {
  TGAS, argsBytes, buildFunctionCallTx, deviceKey, fromHex, hex, signTx, signedTxBytes, txDigest, txHashOf,
  type FunctionCallTx,
} from "./index";

export const TEST_SEED_HEX = "84c78a29586704d6c17c4b694c4d6afaa0ba16b252ecc61d36fd3828e74e8ca8";

const KEY = deviceKey(fromHex(TEST_SEED_HEX));
/** A fixed 32-byte stand-in for a block hash: sha256("nearling test block"). */
const BLOCK_HASH = sha256(new TextEncoder().encode("nearling test block"));

const COMMON = {
  signerId: "nearling-player1.testnet",
  publicKey: KEY.publicKey,
  nonce: 189_000_000_000_042n,
  receiverId: "pets-v9.nearling.testnet",
  blockHash: base58.encode(BLOCK_HASH),
};

export const VECTOR_INPUTS: Record<string, FunctionCallTx> = {
  approve_action: { ...COMMON, methodName: "approve_action", args: { action_id: "7" }, gas: 450n * TGAS },
  play: { ...COMMON, methodName: "play", args: { pet_id: "5", action: "pet" }, gas: 30n * TGAS },
};

export interface Vector {
  note: string;
  test_seed_hex: string;
  public_key: string;
  public_key_hex: string;
  signer_id: string;
  receiver_id: string;
  nonce: string;
  block_hash_base58: string;
  block_hash_hex: string;
  method_name: string;
  args_json: string;
  gas: string;
  deposit: string;
  tx_borsh_hex: string;
  sha256_hex: string;
  tx_hash_base58: string;
  signature_hex: string;
  signed_tx_hex: string;
  signed_tx_base64: string;
}

export function makeVector(input: FunctionCallTx): Vector {
  const tx = buildFunctionCallTx(input);
  const sig = signTx(tx, KEY.secretKey);
  const signed = signedTxBytes(tx, sig);
  const blockHash = typeof input.blockHash === "string" ? base58.decode(input.blockHash) : input.blockHash;
  return {
    note: "TEST-ONLY throwaway key, public in the repo, registered nowhere. Never use it on a real device or account.",
    test_seed_hex: TEST_SEED_HEX,
    public_key: KEY.publicKey,
    public_key_hex: hex(base58.decode(KEY.publicKey.slice("ed25519:".length))),
    signer_id: input.signerId,
    receiver_id: input.receiverId,
    nonce: String(input.nonce),
    block_hash_base58: base58.encode(blockHash),
    block_hash_hex: hex(blockHash),
    method_name: input.methodName,
    args_json: new TextDecoder().decode(argsBytes(input.args)),
    gas: input.gas.toString(),
    deposit: "0",
    tx_borsh_hex: hex(tx),
    sha256_hex: hex(txDigest(tx)),
    tx_hash_base58: txHashOf(tx),
    signature_hex: hex(sig),
    signed_tx_hex: hex(signed),
    signed_tx_base64: base64.encode(signed),
  };
}
