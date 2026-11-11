import { describe, expect, it } from "vitest";
import {
  DEMO_PETS_CONTRACT,
  eventData,
  formatNear,
  GAS,
  nearToThoughts,
  outcomeFailure,
  parseEvents,
  parseNear,
  petFromRef,
  PETS_CONTRACT,
  returnValue,
  soulBytes,
  tx,
  txHash,
  type Outcome,
} from "./chain";
import { chainErrorCode, chainErrorCopy, friendlyChainError, isWalletRejection } from "./errors";
import { buildApprovalTx } from "../components/wallet/approvalTx";
import type { Approval } from "../components/wallet/brainApi";

const b64 = (s: string) => btoa(s);

describe("petFromRef", () => {
  it("accepts our two contracts, URL-encoded or not", () => {
    expect(petFromRef(encodeURIComponent(`${PETS_CONTRACT}:3`))).toEqual({ contract: PETS_CONTRACT, tokenId: "3", ref: `${PETS_CONTRACT}:3` });
    expect(petFromRef(`${DEMO_PETS_CONTRACT}:0`)?.contract).toBe(DEMO_PETS_CONTRACT);
  });
  it("rejects other contracts and bad ids", () => {
    expect(petFromRef("evil.testnet:1")).toBeNull();
    expect(petFromRef(`${PETS_CONTRACT}:x`)).toBeNull();
    expect(petFromRef("%E0%A4%A")).toBeNull();
  });
});

describe("amounts", () => {
  it("parses and formats NEAR", () => {
    expect(parseNear("1")).toBe(10n ** 24n);
    expect(parseNear("0.5")).toBe(5n * 10n ** 23n);
    expect(parseNear("0")).toBeNull();
    expect(parseNear("-1")).toBeNull();
    expect(parseNear("abc")).toBeNull();
    expect(formatNear("200000000000000000000000")).toBe("0.2");
    expect(formatNear(10n ** 24n)).toBe("1");
  });
  it("counts Soul bytes, not characters", () => {
    expect(soulBytes("abc")).toBe(3);
    expect(soulBytes("é")).toBe(2);
  });
});

describe("tx builders", () => {
  it("uses CONTRACT_INTERFACE deposits and gas", () => {
    const stake = tx.stake(PETS_CONTRACT, "1", 10n ** 24n).actions[0]!;
    expect(stake).toEqual({
      type: "FunctionCall",
      params: { methodName: "stake", args: { pet_id: "1" }, gas: (450n * 10n ** 12n).toString(), deposit: (10n ** 24n).toString() },
    });
    const claim = tx.claimShirt();
    expect(claim.actions[0]!.params).toMatchObject({ methodName: "claim", deposit: (10n ** 22n).toString(), gas: GAS.claimShirt.toString() });
    expect(tx.mintPet(PETS_CONTRACT, "Mochi", null, 2n).actions[0]!.params).toMatchObject({ args: { name: "Mochi" }, deposit: "2" });
    expect(tx.unstake(PETS_CONTRACT, "1", 5n).actions[0]!.params).toMatchObject({ args: { pet_id: "1", amount: "5" }, deposit: "0" });
    expect(tx.nftTransfer(PETS_CONTRACT, "bob.testnet", "1").actions[0]!.params).toMatchObject({ deposit: "1" });
  });
});

describe("pets-v9 builders", () => {
  it("builds pantry calls at 30 Tgas", () => {
    expect(tx.stockPantry(PETS_CONTRACT, "1", 5n).actions[0]!.params).toEqual({
      methodName: "stock_pantry", args: { pet_id: "1" }, gas: (30n * 10n ** 12n).toString(), deposit: "5",
    });
    expect(tx.feedFromPantry(PETS_CONTRACT, "1", 7n).actions[0]!.params).toEqual({
      methodName: "feed_from_pantry", args: { pet_id: "1", amount: "7" }, gas: GAS.pantry.toString(), deposit: "0",
    });
    expect(tx.emptyPantry(PETS_CONTRACT, "1", 9n).actions[0]!.params).toMatchObject({
      methodName: "empty_pantry", args: { pet_id: "1", amount: "9" }, deposit: "0",
    });
  });
  it("attaches the pool unstake deposit when given", () => {
    expect(tx.unstake(PETS_CONTRACT, "1", 5n, 7_720n).actions[0]!.params).toMatchObject({
      args: { pet_id: "1", amount: "5" }, gas: GAS.garden.toString(), deposit: "7720",
    });
  });
  it("estimates thoughts from NEAR", () => {
    // 0.5 NEAR at $0.20 = $0.10 = 100 thoughts at $0.001
    expect(nearToThoughts(5n * 10n ** 23n, 200_000, 1_000)).toBe(100);
    expect(nearToThoughts("0", 200_000, 1_000)).toBe(0);
    expect(nearToThoughts(10n ** 24n, 200_000, 0)).toBe(0);
  });
});

describe("outcome parsing", () => {
  const ok: Outcome = {
    status: { SuccessValue: b64('"7"') },
    transaction: { hash: "HASH" },
    receipts_outcome: [
      {
        outcome: {
          logs: [
            'EVENT_JSON:{"standard":"nep171","version":"1.0.0","event":"nft_mint","data":[{"owner_id":"a.testnet","token_ids":["7"]}]}',
            "plain log",
            'EVENT_JSON:{"standard":"nearling","version":"1.0.0","event":"soul_updated","data":[{"pet_id":"7","version":1}]}',
          ],
        },
      },
    ],
  };
  it("reads events, return value and hash", () => {
    expect(parseEvents(ok).map((e) => e.event)).toEqual(["nft_mint", "soul_updated"]);
    expect(eventData<{ version: number }>(parseEvents(ok), "soul_updated")[0]?.version).toBe(1);
    expect(returnValue<string>(ok)).toBe("7");
    expect(txHash(ok)).toBe("HASH");
    expect(outcomeFailure(ok)).toBeNull();
  });
  it("maps a panic to its code and copy", () => {
    const bad: Outcome = {
      status: {
        Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: E_MIN_STAKE: at least 1 NEAR" } } } },
      },
    };
    const f = outcomeFailure(bad)!;
    expect(chainErrorCode(f)).toBe("E_MIN_STAKE");
    expect(friendlyChainError(f).message).toBe("Plant at least 1 NEAR in the Brain Garden.");
    expect(chainErrorCopy("E_STAKED", "Mochi")).toBe("Take Mochi's NEAR out of the Brain Garden before giving Mochi away.");
    expect(chainErrorCopy(null)).toBe("Something went wrong");
  });
  it("detects wallet rejections", () => {
    expect(isWalletRejection(new Error("User rejected the request"))).toBe(true);
    expect(isWalletRejection(new Error("E_DEPOSIT: wrong"))).toBe(false);
  });
});

describe("approval tx", () => {
  const base: Approval = {
    id: "a1",
    kind: "send",
    network: "testnet",
    account_id: "me.testnet",
    receiver_id: "friend.testnet",
    amount_yocto: "1000",
    status: "approved",
    expires_at: Date.now() + 60_000,
  };
  it("builds only from the record", () => {
    expect(buildApprovalTx(base)).toEqual({ receiverId: "friend.testnet", actions: [{ type: "Transfer", params: { deposit: "1000" } }] });
    expect(buildApprovalTx({ ...base, kind: "stake", validator: "pool.testnet" })?.receiverId).toBe("pool.testnet");
    expect(buildApprovalTx({ ...base, kind: "transfer_pet", pet_ref: `${PETS_CONTRACT}:4`, amount_yocto: null })?.actions[0]).toMatchObject({
      params: { methodName: "nft_transfer", args: { receiver_id: "friend.testnet", token_id: "4" }, deposit: "1" },
    });
  });
  it("refuses mainnet, empty amounts and foreign pet contracts", () => {
    expect(buildApprovalTx({ ...base, network: "mainnet" })).toBeNull();
    expect(buildApprovalTx({ ...base, amount_yocto: "0" })).toBeNull();
    expect(buildApprovalTx({ ...base, kind: "transfer_pet", pet_ref: "evil.testnet:1" })).toBeNull();
  });
});

describe("device key and approval tx builders", () => {
  const PK = "ed25519:BXWkER31HSLP1kSVvMduQHsJxyAopCrTkUfWbuLJ7AvH";
  it("adds a limited key on the owner's own account", () => {
    expect(tx.addDeviceKey("alice.testnet", PETS_CONTRACT, PK, false)).toEqual({
      receiverId: "alice.testnet",
      actions: [
        {
          type: "AddKey",
          params: {
            publicKey: PK,
            accessKey: {
              permission: {
                receiverId: PETS_CONTRACT,
                allowance: "1000000000000000000000000",
                methodNames: ["play", "stake_from_food", "approve_action"],
              },
            },
          },
        },
      ],
    });
    const v9 = tx.addDeviceKey("alice.testnet", PETS_CONTRACT, PK, true).actions[0];
    expect(v9?.type === "AddKey" ? v9.params.accessKey.permission.methodNames : []).toContain("feed_from_pantry");
    expect(tx.deleteKey("alice.testnet", PK)).toEqual({ receiverId: "alice.testnet", actions: [{ type: "DeleteKey", params: { publicKey: PK } }] });
  });

  it("registers the device and proposes actions with the right gas and deposit", () => {
    const fc = (r: { actions: { type: string; params: unknown }[] }) => (r.actions[0]?.type === "FunctionCall" ? r.actions[0].params : null);
    expect(fc(tx.registerDevice(PETS_CONTRACT, "3", PK))).toEqual({
      methodName: "register_device", args: { pet_id: "3", public_key: PK }, gas: GAS.device.toString(), deposit: "0",
    });
    expect(fc(tx.setApprovalMode(PETS_CONTRACT, "3", true))).toMatchObject({ args: { pet_id: "3", on: true } });
    expect(fc(tx.proposeAction(PETS_CONTRACT, "3", { Stake: { amount: "1000" } }, 1000n))).toEqual({
      methodName: "propose_action", args: { pet_id: "3", action: { Stake: { amount: "1000" } } }, gas: "30000000000000", deposit: "1000",
    });
    expect(fc(tx.proposeAction(PETS_CONTRACT, "3", "Withdraw"))).toMatchObject({ args: { pet_id: "3", action: "Withdraw" } });
    expect(fc(tx.cancelAction(PETS_CONTRACT, "9"))).toMatchObject({ methodName: "cancel_action", args: { action_id: "9" }, deposit: "0" });
    expect(GAS.approve).toBe(450n * 1_000_000_000_000n);
  });
});
