import { describe, expect, it } from "vitest";
import { KeyPair, KeyPairSigner, baseEncode, type Provider } from "near-api-js";
import { NEP413_MESSAGE, NEP413_RECIPIENT } from "@petto/shared";
import { createApp } from "../app";
import { testDeps } from "../test/deps";
import { authRoutes, decodeSignature, nep413Verifier, type Nep413Verifier } from "./auth";

const post = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function setup(verifier: Nep413Verifier, start = 1_800_000_000_000) {
  let t = start;
  const deps = testDeps({ now: () => t });
  const app = createApp(deps, [{ name: "auth", routes: (d) => authRoutes(d, verifier) }]);
  return { app, advance: (ms: number) => (t += ms) };
}

const okVerifier: Nep413Verifier = async () => {};
const body = (nonce: string) => ({ accountId: "alice.testnet", publicKey: "ed25519:abc", signature: "c2ln", nonce });

describe("NEP-413 sign-in", () => {
  it("issues a session for a verified signature", async () => {
    const seen: Parameters<Nep413Verifier>[0][] = [];
    const { app } = setup(async (a) => void seen.push(a));
    const n = (await (await app.request("/auth/nonce")).json()) as { nonce: string; message: string; recipient: string };
    expect(n.message).toBe(NEP413_MESSAGE);
    expect(n.recipient).toBe(NEP413_RECIPIENT);
    expect(Buffer.from(n.nonce, "base64")).toHaveLength(32);

    const res = await app.request("/session", post(body(n.nonce)));
    expect(res.status).toBe(200);
    const s = (await res.json()) as { token: string; accountId: string; expires_at: number };
    expect(s.accountId).toBe("alice.testnet");
    expect(s.token.split(".")).toHaveLength(3);
    expect(Buffer.from(seen[0]!.nonce).toString("base64")).toBe(n.nonce);
  });

  it("uses a nonce once", async () => {
    const { app } = setup(okVerifier);
    const { nonce } = (await (await app.request("/auth/nonce")).json()) as { nonce: string };
    expect((await app.request("/session", post(body(nonce)))).status).toBe(200);
    const again = await app.request("/session", post(body(nonce)));
    expect(again.status).toBe(401);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("expired");
  });

  it("rejects an expired nonce", async () => {
    const { app, advance } = setup(okVerifier);
    const { nonce } = (await (await app.request("/auth/nonce")).json()) as { nonce: string };
    advance(5 * 60_000);
    expect((await app.request("/session", post(body(nonce)))).status).toBe(401);
  });

  it("rejects a bad signature and burns the nonce", async () => {
    const { app } = setup(async () => {
      throw new Error("Signature verification failed");
    });
    const { nonce } = (await (await app.request("/auth/nonce")).json()) as { nonce: string };
    const res = await app.request("/session", post(body(nonce)));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });
});

describe("nep413Verifier", () => {
  const key = KeyPair.fromRandom("ed25519");
  const nonce = new Uint8Array(32).fill(9);
  const provider = (permission: unknown) => ({ viewAccessKey: async () => ({ permission }) }) as unknown as Provider;

  async function sign(message = NEP413_MESSAGE) {
    return new KeyPairSigner(key).signNep413Message("alice.testnet", { message, recipient: NEP413_RECIPIENT, nonce });
  }

  it("accepts a real signature from a full access key", async () => {
    const signed = await sign();
    await expect(
      nep413Verifier(provider("FullAccess"))({ accountId: "alice.testnet", publicKey: key.getPublicKey().toString(), signature: signed.signature, nonce }),
    ).resolves.toBeUndefined();
  });

  it("POST /session accepts base64, ed25519:<base58> and hex signatures (D2)", async () => {
    const verifier = nep413Verifier(provider("FullAccess"));
    for (const encode of [
      (b: Uint8Array) => Buffer.from(b).toString("base64"),
      (b: Uint8Array) => `ed25519:${baseEncode(b)}`,
      (b: Uint8Array) => Buffer.from(b).toString("hex"),
    ]) {
      const { app } = setup(verifier);
      const n = (await (await app.request("/auth/nonce")).json()) as { nonce: string };
      const signed = await new KeyPairSigner(key).signNep413Message("alice.testnet", {
        message: NEP413_MESSAGE, recipient: NEP413_RECIPIENT, nonce: Buffer.from(n.nonce, "base64"),
      });
      const res = await app.request(
        "/session",
        post({ accountId: "alice.testnet", publicKey: key.getPublicKey().toString(), signature: encode(signed.signature), nonce: n.nonce }),
      );
      expect(res.status).toBe(200);
    }
  });

  it("decodeSignature rejects junk", () => {
    expect(decodeSignature("not base64!")).toBeNull();
    expect(decodeSignature("ed25519:0OIl")).toBeNull(); // not base58
    expect(decodeSignature("ab".repeat(64))).toHaveLength(64);
  });

  // Privy social login gives an implicit account (hex of its ed25519 key) that has no on-chain
  // record until funded, so viewAccessKey fails; the key itself proves control of the account.
  const implicitId = () => Buffer.from(key.getPublicKey().data).toString("hex");
  const missing = { viewAccessKey: async () => { throw new Error("account does not exist"); } } as unknown as Provider;
  async function signAs(accountId: string, message = NEP413_MESSAGE) {
    return new KeyPairSigner(key).signNep413Message(accountId, { message, recipient: NEP413_RECIPIENT, nonce });
  }

  it("accepts an unfunded implicit account signed by its own key", async () => {
    const id = implicitId();
    const signed = await signAs(id);
    await expect(
      nep413Verifier(missing)({ accountId: id, publicKey: key.getPublicKey().toString(), signature: signed.signature, nonce }),
    ).resolves.toBeUndefined();
  });

  it("rejects an implicit account id that is not the signing key", async () => {
    const other = Buffer.from(KeyPair.fromRandom("ed25519").getPublicKey().data).toString("hex");
    const signed = await signAs(other);
    await expect(
      nep413Verifier(missing)({ accountId: other, publicKey: key.getPublicKey().toString(), signature: signed.signature, nonce }),
    ).rejects.toThrow();
  });

  it("rejects a bad signature for an implicit account", async () => {
    const id = implicitId();
    const wrong = await signAs(id, "Send all my NEAR");
    await expect(
      nep413Verifier(missing)({ accountId: id, publicKey: key.getPublicKey().toString(), signature: wrong.signature, nonce }),
    ).rejects.toThrow();
  });

  it("rejects another message and a function-call key", async () => {
    const wrong = await sign("Send all my NEAR");
    const args = { accountId: "alice.testnet", publicKey: key.getPublicKey().toString(), signature: wrong.signature, nonce };
    await expect(nep413Verifier(provider("FullAccess"))(args)).rejects.toThrow();
    const right = await sign();
    await expect(nep413Verifier(provider({ FunctionCall: {} }))({ ...args, signature: right.signature })).rejects.toThrow();
  });
});
