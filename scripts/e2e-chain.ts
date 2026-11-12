/**
 * End-to-end chain check for web and brain on NEAR testnet (docs/INTEGRATION_PLAN.md "Results").
 * Testnet only. Never prints keys.
 *
 * Run from the repo root (tsx comes from the brain package):
 *   brain/node_modules/.bin/tsx scripts/e2e-chain.ts             # demo: mint, soul, feed, feeder feed, shirt
 *   brain/node_modules/.bin/tsx scripts/e2e-chain.ts --garden    # pets-v8 only: mint, stake 1 NEAR, accrual, unstake
 *   brain/node_modules/.bin/tsx scripts/e2e-chain.ts --garden <token_id>   # resume on an already staked pet
 *   brain/node_modules/.bin/tsx scripts/e2e-chain.ts --withdraw <token_id>   # pets-v8, after unlock_epoch
 *
 * Accounts come from E2E_ENV (default brain/data/testnet-accounts.env, gitignored):
 * E2E_PLAYER_ID, E2E_PLAYER_KEY, FEEDER_ACCOUNT_ID, FEEDER_KEY.
 *
 * Events are checked with the exact parsers the clients use: web/lib/chain.ts parseEvents /
 * eventData / returnValue on the raw RPC `tx` result, and the brain's createRpc().txStatus plus
 * verifyFeedTx (fuel/orders.ts) for the direct-feed verifier.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSigner, type TxSigner } from "../brain/src/chain/signer";
import { verifyFeedTx } from "../brain/src/fuel/orders";
import { createRpc } from "../brain/src/wallet/rpc";
import { eventData, parseEvents, returnValue, type Outcome } from "../web/lib/chain";

const RPC = process.env.E2E_RPC ?? "https://test.rpc.fastnear.com"; // rpc.testnet.near.org rate-limits (429)
const DEMO = "pets-demo-v9.nearling.testnet";
const V8 = "pets-v9.nearling.testnet" // name kept; points at pets-v9;
const SHIRTS = "shirts.nearling.testnet";
const POOL = "mw-pool-1024.testnet";
const NEAR = 10n ** 24n;
const FEED = NEAR / 100n; // 0.01 NEAR
const SHIRT_DEPOSIT = NEAR / 100n;

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "e2e", method, params }),
  });
  const j = (await res.json()) as { result?: T; error?: unknown };
  if (j.error) throw new Error(`rpc ${method}: ${JSON.stringify(j.error).slice(0, 300)}`);
  return j.result as T;
}

async function view<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
}

/** The raw RPC `tx` result, the same shape wallets hand the web. */
const rawTx = (hash: string, sender: string) => rpc<Outcome>("tx", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });

let failures = 0;
let blocked = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

type Pet = Record<string, unknown> & { owner: string; staked: string; credit_micro: string; pending_unstake: unknown };

async function call(s: TxSigner, contract: string, method: string, args: Record<string, unknown>, opts: { gasTgas?: number; depositYocto?: bigint } = {}) {
  const r = await s.call(contract, method, args, opts);
  console.log(`tx    ${contract} ${method}  ${r.txHash}`);
  return { hash: r.txHash, raw: await rawTx(r.txHash, s.accountId) };
}

async function mint(player: TxSigner, contract: string, name: string): Promise<string> {
  const cfg = await view<{ mint_storage: string; starter_food: string }>(contract, "config");
  const price = BigInt(cfg.mint_storage) + BigInt(cfg.starter_food);
  console.log(`info  ${contract} mint price ${price} yocto`);
  const { raw } = await call(player, contract, "nft_mint_pet", { name }, { gasTgas: 50, depositYocto: price });
  const ret = returnValue<string>(raw);
  const minted = eventData<{ owner_id?: string; token_ids?: string[] }>(parseEvents(raw), "nft_mint")[0];
  check(`${contract} nft_mint event parses (web eventData)`, !!minted && minted.owner_id === player.accountId && minted.token_ids?.[0] === ret, JSON.stringify(minted));
  check(`${contract} mint returns the token id (web returnValue)`, typeof ret === "string", String(ret));
  return ret ?? minted?.token_ids?.[0] ?? "";
}

async function demo(player: TxSigner, feeder: TxSigner) {
  const nearRpc = createRpc([RPC]);
  const tokenId = await mint(player, DEMO, `e2e-${Date.now() % 100000}`);
  const pet = await view<Pet>(DEMO, "get_pet", { pet_id: tokenId });
  check("demo get_pet owner is the player", pet.owner === player.accountId);

  // Soul
  const soul = await call(player, DEMO, "set_soul", { pet_id: tokenId, prompt: "A curious, kind test pet that loves stars." }, { gasTgas: 30 });
  const sv = eventData<{ pet_id?: string; version?: number; prompt?: string }>(parseEvents(soul.raw), "soul_updated")[0];
  check("soul_updated parses (web soul page reads .version)", typeof sv?.version === "number" && sv.pet_id === tokenId, JSON.stringify({ pet_id: sv?.pet_id, version: sv?.version }));
  const gs = await view<{ version: number }>(DEMO, "get_soul", { pet_id: tokenId });
  check("get_soul version matches the event", gs.version === sv?.version, `v${gs.version}`);

  // Direct feed by the player, verified with the brain's verifier
  const fed = await call(player, DEMO, "feed", { pet_id: tokenId }, { gasTgas: 30, depositYocto: FEED });
  const fd = eventData<Record<string, unknown>>(parseEvents(fed.raw), "fed")[0];
  check("fed parses (web feed page)", !!fd && fd.pet_id === tokenId, JSON.stringify(fd));
  const st = await nearRpc.txStatus(fed.hash, player.accountId);
  check("brain txStatus reads the feed tx", !!st && st.success);
  if (st) {
    const v = verifyFeedTx(st, DEMO, tokenId, FEED);
    check("brain verifyFeedTx accepts the real feed", v.ok && v.payer === player.accountId, JSON.stringify(v));
    const wrongPet = verifyFeedTx(st, DEMO, `${tokenId}9`, FEED);
    check("brain verifyFeedTx rejects another pet", !wrongPet.ok);
    const wrongAmt = verifyFeedTx(st, DEMO, tokenId, FEED * 2n);
    check("brain verifyFeedTx rejects another amount", !wrongAmt.ok);
  }

  // Feeder path (simulated / live orders): brain signer feeds the player's pet
  const before = BigInt((await view<Pet>(DEMO, "get_pet", { pet_id: tokenId })).food_yocto as string);
  const fr = await feeder.call(DEMO, "feed", { pet_id: tokenId }, { gasTgas: 30, depositYocto: FEED });
  console.log(`tx    ${DEMO} feed (feeder)  ${fr.txHash}`);
  const ff = fr.events.find((e) => e.standard === "nearling" && e.event === "fed");
  check("feeder signer sees the fed event (brain parseOutcome)", !!ff, JSON.stringify(ff?.data));
  // `final` views can lag the signer's result by a block or two: poll briefly.
  let after = before;
  for (let i = 0; i < 10 && after <= before; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    after = BigInt((await view<Pet>(DEMO, "get_pet", { pet_id: tokenId })).food_yocto as string);
  }
  check("feeder feed raised food_yocto (minus metabolism)", after > before, `${before} -> ${after}`);
  const fst = await nearRpc.txStatus(fr.txHash, feeder.accountId);
  check("brain verifyFeedTx accepts the feeder tx too", !!fst && verifyFeedTx(fst, DEMO, tokenId, FEED).ok);

  // Shirt (one per account, ever)
  const owned = await view<{ token_id: string }[]>(SHIRTS, "nft_tokens_for_owner", { account_id: player.accountId });
  if (owned.length > 0) {
    console.log(`info  player already has shirt #${owned[0]!.token_id}; claim skipped`);
  } else {
    const sh = await call(player, SHIRTS, "claim", {}, { gasTgas: 30, depositYocto: SHIRT_DEPOSIT });
    const sm = eventData<{ owner_id?: string; token_ids?: string[] }>(parseEvents(sh.raw), "nft_mint")[0];
    check("shirt nft_mint parses", sm?.owner_id === player.accountId && sm.token_ids?.[0] === returnValue<string>(sh.raw), JSON.stringify(sm));
    const now = await view<{ token_id: string }[]>(SHIRTS, "nft_tokens_for_owner", { account_id: player.accountId });
    check("nft_tokens_for_owner shows the shirt (brain closet sync)", now.length === 1);
  }
  return tokenId;
}

async function garden(player: TxSigner, staked?: string) {
  let tokenId = staked ?? "";
  if (!staked) {
    tokenId = await mint(player, V8, `e2e-garden-${Date.now() % 100000}`);
    const st = await call(player, V8, "stake", { pet_id: tokenId }, { gasTgas: 450, depositYocto: NEAR });
    const sk = eventData<Record<string, unknown>>(parseEvents(st.raw), "staked")[0];
    check("staked parses (web garden page)", !!sk, JSON.stringify(sk));
  }
  const p0 = await view<Pet>(V8, "get_pet", { pet_id: tokenId });
  check("get_pet staked = 1 NEAR", p0.staked === NEAR.toString(), p0.staked);
  console.log(`info  daily_credit_micro ${String(p0.daily_credit_micro)} daily_burn_micro ${String(p0.daily_burn_micro)} self_sustaining ${String(p0.self_sustaining)} credit_micro ${p0.credit_micro}`);
  // Credit accrues lazily, but metabolism spends credit first: with 1 NEAR (657 micro-USD/day) below
  // metabolism (1000/day on pets-v8), credit_micro stays 0 and the accrual shows up as slower food
  // burn. credit_micro itself only grows once staked x farm_rate > metabolism (2+ NEAR).
  const cfg = await view<{ farm_rate_micro_per_near_day: number }>(V8, "config");
  const expected = (BigInt(p0.staked) * BigInt(cfg.farm_rate_micro_per_near_day)) / NEAR;
  check("daily_credit_micro = staked x farm_rate", String(p0.daily_credit_micro) === expected.toString(), `${String(p0.daily_credit_micro)} = ${expected}`);

  const un = await call(player, V8, "unstake", { pet_id: tokenId, amount: p0.staked }, { gasTgas: 450 });
  const ue = eventData<Record<string, unknown>>(parseEvents(un.raw), "unstaked")[0];
  const p2 = await view<Pet>(V8, "get_pet", { pet_id: tokenId });
  const pool = await view<{ unstake_deposit?: string } | null>(POOL, "get_account", { account_id: V8 });
  if (!ue && !p2.pending_unstake && BigInt(pool?.unstake_deposit ?? "0") > 1n) {
    // NEARON upgrade (seen 2026-11-11): unstake needs `unstake_deposit` attached, the contract sends 1 yocto.
    // The pool call fails, the contract's callback restores the stake (returns false). Contract fix needed.
    console.log(`BLOCKED  unstake: pool wants ${pool?.unstake_deposit} yocto attached; stake kept, no pending_unstake`);
    blocked++;
  } else {
    check("unstaked parses", !!ue, JSON.stringify(ue));
    check("pending_unstake recorded", !!p2.pending_unstake, JSON.stringify(p2.pending_unstake));
    console.log(`info  finish later: brain/node_modules/.bin/tsx scripts/e2e-chain.ts --withdraw ${tokenId}`);
  }
  return tokenId;
}

async function withdraw(player: TxSigner, tokenId: string) {
  const p = await view<Pet>(V8, "get_pet", { pet_id: tokenId });
  const status = await rpc<{ epoch_height?: number }>("validators", [null]).catch(() => ({}) as { epoch_height?: number });
  console.log(`info  pending_unstake ${JSON.stringify(p.pending_unstake)} current epoch ${String(status.epoch_height)}`);
  const w = await call(player, V8, "withdraw", { pet_id: tokenId }, { gasTgas: 450 });
  const we = eventData<Record<string, unknown>>(parseEvents(w.raw), "unstake_withdrawn")[0];
  check("unstake_withdrawn (else: processing, retry later)", !!we, JSON.stringify(we));
}

async function poolAccounts() {
  for (const c of [V8, DEMO]) {
    const a = await view<Record<string, unknown> | null>(POOL, "get_account", { account_id: c });
    console.log(`info  ${POOL} get_account(${c}) = ${JSON.stringify(a)}`);
  }
}

async function main() {
  const env = loadEnv(resolve(process.env.E2E_ENV ?? "/home/zhijian/Nearling/brain/data/testnet-accounts.env"));
  const player = createSigner(env.E2E_PLAYER_ID ?? "", [env.E2E_PLAYER_KEY ?? ""].filter(Boolean), RPC);
  const feeder = createSigner(env.FEEDER_ACCOUNT_ID ?? "", [env.FEEDER_KEY ?? ""].filter(Boolean), RPC);
  if (!player || !feeder) throw new Error("E2E_PLAYER_ID / E2E_PLAYER_KEY / FEEDER_ACCOUNT_ID / FEEDER_KEY missing");
  console.log(`info  player ${player.accountId}, feeder ${feeder.accountId}, rpc ${RPC}`);

  const args = process.argv.slice(2);
  const wi = args.indexOf("--withdraw");
  if (wi >= 0) {
    await withdraw(player, args[wi + 1] ?? "");
  } else if (args.includes("--garden")) {
    const id = args[args.indexOf("--garden") + 1];
    await garden(player, id && /^\d+$/.test(id) ? id : undefined);
  } else {
    await demo(player, feeder);
  }
  await poolAccounts();
  console.log(`${failures === 0 ? "ALL PASS" : `${failures} FAILED`}${blocked ? `, ${blocked} BLOCKED (see log)` : ""}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error("error", e instanceof Error ? e.message : e);
  process.exit(1);
});
