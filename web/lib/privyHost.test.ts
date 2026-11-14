import { describe, expect, it } from "vitest";
import { PETS_CONTRACT, tx } from "./chain";
import { autoApprove, describeRequest, toNearAction } from "./privyHost";

describe("toNearAction", () => {
  it("maps a function call with its gas and deposit", () => {
    const a = toNearAction(tx.feed(PETS_CONTRACT, "1", 10n ** 23n).actions[0]!);
    expect(a.functionCall?.methodName).toBe("feed");
    expect(a.functionCall?.gas).toBe(30n * 10n ** 12n);
    expect(a.functionCall?.deposit).toBe(10n ** 23n);
  });

  it("maps a limited device key and a transfer", () => {
    const key = toNearAction(
      tx.addDeviceKey("alice.testnet", PETS_CONTRACT, "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp", true).actions[0]!,
    );
    expect(key.addKey?.accessKey.permission.functionCall?.receiverId).toBe(PETS_CONTRACT);
    expect(toNearAction(tx.transfer("bob.testnet", 5n).actions[0]!).transfer?.deposit).toBe(5n);
  });
});

describe("describeRequest", () => {
  it("connect shows the message being signed", () => {
    const d = describeRequest("signInAndSignMessage", { messageParams: { message: "Sign in to Petto" } });
    expect(d.title).toBe("Connect to Petto");
    expect(d.lines).toContain("Sign the message: Sign in to Petto");
    expect(d.gasless).toBe(false);
  });

  it("a relayed call says Petto pays the gas and shows the NEAR attached", () => {
    const d = describeRequest("signDelegateActions", { delegateActions: [tx.feed(PETS_CONTRACT, "1", 10n ** 23n)] });
    expect(d.title).toBe("Approve");
    expect(d.lines).toEqual([`feed on ${PETS_CONTRACT}, attach 0.1 NEAR`]);
    expect(d.gasless).toBe(true);
  });

  it("a normal transaction lists each call and key change", () => {
    const d = describeRequest("signAndSendTransactions", {
      transactions: [
        tx.addDeviceKey("alice.testnet", PETS_CONTRACT, "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp", true),
        tx.registerDevice(PETS_CONTRACT, "1", "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"),
      ],
    });
    expect(d.lines).toEqual([`Add a limited key for ${PETS_CONTRACT} on alice.testnet`, `register_device on ${PETS_CONTRACT}`]);
    expect(d.gasless).toBe(false);
  });
});

describe("autoApprove", () => {
  const pk = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";

  it("skips the modal for connecting and the sign-in message", () => {
    expect(autoApprove("signIn", {})).toBe(true);
    expect(autoApprove("signInAndSignMessage", { messageParams: { message: "Sign in to Petto" } })).toBe(true);
    expect(autoApprove("signMessage", { message: "Sign in to Petto" })).toBe(true);
  });

  it("skips it for zero-deposit calls to our contracts, relayed or not", () => {
    expect(autoApprove("signDelegateActions", { delegateActions: [tx.setSoul(PETS_CONTRACT, "1", "Brave.")] })).toBe(true);
    expect(autoApprove("signAndSendTransaction", tx.registerDevice(PETS_CONTRACT, "1", pk))).toBe(true);
  });

  it("asks when NEAR is attached (mint, feed, shirt) or the pet changes hands (1 yocto)", () => {
    expect(autoApprove("signDelegateActions", { delegateActions: [tx.feed(PETS_CONTRACT, "1", 10n ** 23n)] })).toBe(false);
    expect(autoApprove("signDelegateActions", { delegateActions: [tx.claimShirt()] })).toBe(false);
    expect(autoApprove("signAndSendTransaction", tx.nftTransfer(PETS_CONTRACT, "bob.testnet", "1"))).toBe(false);
  });

  it("asks for keys, plain transfers and other contracts", () => {
    const keyAndRegister = { transactions: [tx.addDeviceKey("alice.testnet", PETS_CONTRACT, pk, true), tx.registerDevice(PETS_CONTRACT, "1", pk)] };
    expect(autoApprove("signAndSendTransactions", keyAndRegister)).toBe(false);
    expect(autoApprove("signAndSendTransaction", tx.transfer("bob.testnet", 1n))).toBe(false);
    expect(autoApprove("signAndSendTransaction", tx.validatorStake("pool.testnet", 0n))).toBe(false);
  });
});
