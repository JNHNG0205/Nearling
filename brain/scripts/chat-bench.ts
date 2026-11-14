// Chat speed benchmark: times real replies through the brain's talk route (same path as the web
// app), from easy to hard messages. Prints only timings and reply lengths, never chat content
// (CLAUDE.md rule 4). Each reply is a real NEAR AI inference and costs the pet 1 fuel.
//
// Run (brain running on BRAIN_URL, test account in brain/data/testnet-accounts.env):
//   cd brain && set -a && . ../.env && . data/testnet-accounts.env && set +a && npx tsx scripts/chat-bench.ts
// Options: BENCH_VOICE=1 also voices each reply (TTS time included, uses voice credits).
//          BENCH_PET=<contract:token_id> picks the pet (default: the player's first pet).
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { signMessage } from "near-api-js/nep413";

const BRAIN = process.env.BRAIN_URL ?? "http://localhost:8787";
const VOICE = process.env.BENCH_VOICE === "1";

const PROMPTS: { level: string; text: string }[] = [
  { level: "1 easy", text: "Hi!" },
  { level: "2 easy", text: "How are you feeling today?" },
  { level: "3 medium", text: "What is your favourite food and why?" },
  { level: "4 medium", text: "Tell me a short joke about clouds." },
  { level: "5 hard", text: "If I have 3 apples and give you half, then buy 7 more, how many do I have?" },
  { level: "6 hard", text: "Explain why the sky is blue, simply, like I'm eight." },
  { level: "7 very hard", text: "Write a tiny four-line poem about a robot learning to dance, with a rhyme." },
  {
    level: "8 very hard",
    text: "Compare cats and dogs as pets: list two pros and two cons for each, then pick one for a busy student.",
  },
];

async function session(id: string, key: string): Promise<string> {
  const n = (await (await fetch(`${BRAIN}/auth/nonce`)).json()) as { nonce: string; message: string; recipient: string };
  const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
  const account = new Account(id, provider, KeyPairSigner.fromSecretKey(key as `ed25519:${string}`));
  const signed = await signMessage({
    signerAccount: account,
    payload: { message: n.message, recipient: n.recipient, nonce: Buffer.from(n.nonce, "base64") },
  });
  const r = await fetch(`${BRAIN}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: signed.accountId,
      publicKey: signed.publicKey.toString(),
      signature: Buffer.from(signed.signature).toString("base64"),
      nonce: n.nonce,
    }),
  });
  if (!r.ok) throw new Error(`POST /session ${r.status}`);
  return ((await r.json()) as { token: string }).token;
}

async function main() {
  const id = process.env.E2E_PLAYER_ID;
  const key = process.env.E2E_PLAYER_KEY;
  if (!id || !key) throw new Error("Set E2E_PLAYER_ID and E2E_PLAYER_KEY (brain/data/testnet-accounts.env)");
  const auth = { Authorization: `Bearer ${await session(id, key)}` };

  let pet = process.env.BENCH_PET;
  if (!pet) {
    const r = (await (await fetch(`${BRAIN}/me/pets`, { headers: auth })).json()) as { pets: { pet_ref: string; fuel: { left: number } }[] };
    const usable = r.pets.filter((p) => p.fuel.left > 0);
    if (usable.length === 0) throw new Error(`${id} owns no pet with fuel on this brain's contracts`);
    pet = usable[0]!.pet_ref;
  }
  console.log(`pet ${pet}, voice ${VOICE ? "on" : "off"}, ${PROMPTS.length} messages\n`);
  console.log("level        total_ms  status  reply_chars  audio");

  const times: number[] = [];
  for (const p of PROMPTS) {
    const t0 = performance.now();
    const res = await fetch(`${BRAIN}/pets/${encodeURIComponent(pet)}/talk`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: crypto.randomUUID(), text: p.text, voice: VOICE }),
    });
    const ms = Math.round(performance.now() - t0);
    const body = (await res.json().catch(() => ({}))) as { status?: string; reply?: string; audio_url?: string | null; error?: { code?: string } };
    const status = res.ok ? (body.status ?? "?") : `http ${res.status} ${body.error?.code ?? ""}`;
    if (res.ok && body.status === "done") times.push(ms);
    console.log(`${p.level.padEnd(12)} ${String(ms).padStart(8)}  ${status.padEnd(6)}  ${String(body.reply?.length ?? 0).padStart(11)}  ${body.audio_url ? "yes" : "no"}`);
    await new Promise((ok) => setTimeout(ok, 3_500)); // brain allows 1 thought per 3 s per pet
  }

  if (times.length) {
    const s = [...times].sort((a, b) => a - b);
    const p50 = s[Math.floor((s.length - 1) / 2)]!;
    console.log(`\ndone ${s.length}/${PROMPTS.length}: min ${s[0]} ms, median ${p50} ms, max ${s.at(-1)} ms`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
