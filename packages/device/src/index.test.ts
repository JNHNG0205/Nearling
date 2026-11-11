import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64 } from "@scure/base";
import { KeyPair, KeyPairSigner, PublicKey, actions, createTransaction, encodeTransaction } from "near-api-js";
import { describe, expect, it } from "vitest";
import {
  BLE_DEVICE_PK_UUID, BLE_PAIRING_URL_UUID, BLE_SERVICE_UUID, buildFunctionCallTx, deviceKey, fromHex, hex,
  publicKeyOf, signTx, signedTxBase64, signedTxBytes, txDigest, type FunctionCallTx,
} from "./index";
import { TEST_SEED_HEX, VECTOR_INPUTS, makeVector, type Vector } from "./vectors";

const KEY = deviceKey(fromHex(TEST_SEED_HEX));

/** Independent Borsh encoder, written the way the firmware does it (DEVICE_SIGNING.md section 2). */
function manualBorsh(p: FunctionCallTx): Uint8Array {
  const out: number[] = [];
  const u32 = (n: number) => out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  const uLE = (v: bigint, bytes: number) => {
    for (let i = 0; i < bytes; i++) out.push(Number((v >> BigInt(8 * i)) & 0xffn));
  };
  const str = (s: string) => {
    const b = new TextEncoder().encode(s);
    u32(b.length);
    out.push(...b);
  };
  const args = new TextEncoder().encode(JSON.stringify(p.args));
  str(p.signerId);
  out.push(0); // KeyType ED25519
  out.push(...base58.decode(p.publicKey.slice(8)));
  uLE(BigInt(p.nonce), 8);
  str(p.receiverId);
  out.push(...base58.decode(p.blockHash as string));
  u32(1); // one action
  out.push(2); // Action::FunctionCall
  str(p.methodName);
  u32(args.length);
  out.push(...args);
  uLE(p.gas, 8);
  uLE(0n, 16);
  return Uint8Array.from(out);
}

describe("device signing", () => {
  it("keys are NEAR format and round-trip", () => {
    const k = deviceKey();
    expect(k.publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(publicKeyOf(k.secretKey)).toBe(k.publicKey);
    expect(KeyPair.fromString(k.secretKey as `ed25519:${string}`).getPublicKey().toString()).toBe(k.publicKey);
  });

  for (const [name, input] of Object.entries(VECTOR_INPUTS)) {
    it(`${name}: Borsh matches the hand-written layout`, () => {
      expect(hex(buildFunctionCallTx(input))).toBe(hex(manualBorsh(input)));
    });

    it(`${name}: signature matches near-api-js KeyPairSigner`, async () => {
      const kp = KeyPair.fromString(KEY.secretKey as `ed25519:${string}`);
      const tx = createTransaction(
        input.signerId, PublicKey.fromString(input.publicKey), input.receiverId, BigInt(input.nonce),
        [actions.functionCall(input.methodName, input.args as object, input.gas, 0n)],
        base58.decode(input.blockHash as string),
      );
      expect(hex(encodeTransaction(tx))).toBe(hex(buildFunctionCallTx(input)));
      const { signedTransaction } = await new KeyPairSigner(kp).signTransaction(tx);
      expect(signedTxBase64(input, KEY.secretKey)).toBe(base64.encode(signedTransaction.encode()));
    });

    it(`${name}: vectors/${name}.json reproduces`, () => {
      const file = JSON.parse(readFileSync(new URL(`../vectors/${name}.json`, import.meta.url), "utf8")) as Vector;
      expect(file).toEqual(makeVector(input));
      const tx = fromHex(file.tx_borsh_hex);
      expect(ed25519.verify(fromHex(file.signature_hex), txDigest(tx), fromHex(file.public_key_hex))).toBe(true);
      expect(hex(signedTxBytes(tx, fromHex(file.signature_hex)))).toBe(file.signed_tx_hex);
    });
  }

  it("rejects a deposit", () => {
    expect(() => buildFunctionCallTx({ ...VECTOR_INPUTS.play!, deposit: 1 as 0 })).toThrow();
  });

  it("signs sha256 of the bytes, not the bytes", () => {
    const tx = buildFunctionCallTx(VECTOR_INPUTS.play!);
    const sig = signTx(tx, KEY.secretKey);
    expect(ed25519.verify(sig, txDigest(tx), base58.decode(KEY.publicKey.slice(8)))).toBe(true);
    expect(ed25519.verify(sig, tx, base58.decode(KEY.publicKey.slice(8)))).toBe(false);
  });

  it("BLE UUIDs are fixed 128-bit values", () => {
    for (const u of [BLE_SERVICE_UUID, BLE_PAIRING_URL_UUID, BLE_DEVICE_PK_UUID]) {
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
