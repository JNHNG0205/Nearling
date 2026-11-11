// One live testnet run of device signing (testnet only, CLAUDE.md rule 2). Prints tx hashes, never keys.
//   pnpm --filter @nearling/device live <accounts.env> <device-key-file> [contract] [pet_id]
// accounts.env needs E2E_PLAYER_ID and E2E_PLAYER_KEY (the pet's owner). The device key file is created
// (mode 600) if missing; keep it outside the repo. Steps: AddKey (function call, 0.25 NEAR allowance),
// register_device from the wallet key, then play(pet, "pet") signed by the device key through sendDeviceTx.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Account, JsonRpcProvider, nearToYocto } from "near-api-js";
import { DEVICE_GAS, DEVICE_METHODS, TGAS, deviceKey, sendDeviceTx, type DeviceKey } from "../src/index";

const [envPath, keyPath, contract = "pets-v8.nearling.testnet", petId = "5"] = process.argv.slice(2);
if (!envPath || !keyPath) throw new Error("usage: live-testnet.ts <accounts.env> <device-key-file> [contract] [pet_id]");
const RPC = "https://test.rpc.fastnear.com";

const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split("\n").filter((l) => /^\w+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
  }),
);
const ownerId = env.E2E_PLAYER_ID;
const ownerKey = env.E2E_PLAYER_KEY;
if (!ownerId || !ownerKey) throw new Error("E2E_PLAYER_ID / E2E_PLAYER_KEY missing");

let key: DeviceKey;
if (existsSync(keyPath)) key = JSON.parse(readFileSync(keyPath, "utf8")) as DeviceKey;
else {
  key = deviceKey();
  writeFileSync(keyPath, JSON.stringify(key), { mode: 0o600 });
}
console.log("device public key", key.publicKey);

const provider = new JsonRpcProvider({ url: RPC });
const owner = new Account(ownerId, provider, ownerKey as `ed25519:${string}`);
const txOf = (r: unknown) => (r as { transaction?: { hash?: string } }).transaction?.hash ?? "?";

const pet = await provider.callFunction<{ owner: string; device_pk: string | null }>({ contractId: contract, method: "get_pet", args: { pet_id: petId } });
if (pet?.owner !== ownerId) throw new Error(`pet ${petId} is not owned by the E2E player`);

const keys = await provider.viewAccessKeyList({ accountId: ownerId, finalityQuery: { finality: "final" } }).catch(() => null);
const hasKey = !!keys?.keys.some((k) => k.public_key === key.publicKey);
if (!hasKey) {
  const r = await owner.addFunctionCallAccessKey({
    publicKey: key.publicKey,
    contractId: contract,
    methodNames: [...DEVICE_METHODS].filter((m) => m !== "feed_from_pantry" || contract.includes("v9")),
    allowance: nearToYocto("0.25"),
  });
  console.log("add_key tx", txOf(r));
}
if (pet.device_pk !== key.publicKey) {
  const r = await owner.callFunctionRaw({
    contractId: contract, methodName: "register_device", args: { pet_id: petId, public_key: key.publicKey }, gas: 30n * TGAS,
  });
  console.log("register_device tx", txOf(r));
}

const play = await sendDeviceTx(RPC, {
  signerId: ownerId, secretKey: key.secretKey, receiverId: contract, methodName: "play",
  args: { pet_id: petId, action: "pet" }, gas: DEVICE_GAS.play,
});
console.log("device play tx", play.txHash, play.failure ? `FAILED ${JSON.stringify(play.failure)}` : "ok");
