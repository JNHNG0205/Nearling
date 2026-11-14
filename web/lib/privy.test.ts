import { describe, expect, it } from "vitest";
import { findNearWallet, oauthReturn, privyManifest, PRIVY_WALLET_ID } from "./privy";

describe("privy wallet manifest", () => {
  const m = privyManifest("https://petto.example");

  it("is a sandbox wallet on testnet that signs on the Petto page itself (no popup)", () => {
    expect(m.id).toBe(PRIVY_WALLET_ID);
    expect(m.type).toBe("sandbox");
    expect(m.executor).toBe("https://petto.example/privy-executor.js");
    expect(m.permissions).toEqual({ storage: true, external: ["pettoPrivy"] });
    expect(m.features.testnet).toBe(true);
  });

  it("supports what the web needs: sign-in with a NEP-413 message and multi-tx (AddKey + register_device)", () => {
    expect(m.features.signInAndSignMessage).toBe(true);
    expect(m.features.signMessage).toBe(true);
    expect(m.features.signAndSendTransaction).toBe(true);
    expect(m.features.signAndSendTransactions).toBe(true);
    expect(m.features.signDelegateActions).toBe(true); // gas relay
  });
});

describe("findNearWallet", () => {
  const near = { type: "wallet", chain_type: "near", id: "w1", address: "ab".repeat(32) };

  it("picks the NEAR wallet even when other wallets are linked", () => {
    const eth = { type: "wallet", chain_type: "ethereum", id: "w0", address: "0xabc" };
    expect(findNearWallet([{ type: "email", address: "a@b.c" }, eth, near])).toEqual({ id: "w1", address: "ab".repeat(32) });
  });

  it("returns null without one", () => {
    expect(findNearWallet([{ type: "google_oauth", email: "a@b.c" }])).toBeNull();
    expect(findNearWallet([])).toBeNull();
  });
});

describe("oauthReturn", () => {
  it("reads Privy's OAuth redirect parameters", () => {
    expect(oauthReturn("?privy_oauth_code=c1&privy_oauth_state=s1&privy_oauth_provider=google")).toEqual({
      code: "c1",
      state: "s1",
      provider: "google",
    });
  });

  it("is null for a normal visit or another provider", () => {
    expect(oauthReturn("?next=/my")).toBeNull();
    expect(oauthReturn("?privy_oauth_code=c1&privy_oauth_state=s1&privy_oauth_provider=evil")).toBeNull();
  });
});
