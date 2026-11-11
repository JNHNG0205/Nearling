import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chain } from "../chain/near";
import type { BrainSigners, TxSigner } from "../chain/signer";
import { publish } from "../events";
import { ensureProfile } from "../profiles";
import { testDeps } from "../test/deps";
import { buildPetMetadata, utf8Prefix } from "./build";
import { metadataRoutes, startMetadataSync } from "./index";
import { createPinata, gatewayBase, PINATA_UPLOAD_URL } from "./pinata";
import { createDebouncer, createFeatureCheck, latestMetadata, syncPetMetadata, type Timers } from "./sync";

const REF = "pets-v8.nearling.testnet:1";
const SOUL = "A cheerful pet who loves gardens.";

/** Fake Pinata v3: CID = "bafk" + sha256 of the uploaded bytes, so identical content gives the same CID. */
function fakePinata() {
  const uploads: { name: string; type: string; bytes: Buffer; auth: string | null; network: string | null }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    expect(url).toBe(PINATA_UPLOAD_URL);
    const form = init.body as FormData;
    const file = form.get("file") as File;
    const bytes = Buffer.from(await file.arrayBuffer());
    uploads.push({
      name: String(form.get("name")),
      type: file.type,
      bytes,
      auth: new Headers(init.headers).get("authorization"),
      network: form.get("network") as string | null,
    });
    const cid = `bafk${createHash("sha256").update(bytes).digest("hex").slice(0, 20)}`;
    return new Response(JSON.stringify({ data: { id: "x", cid, is_duplicate: false } }), { status: 200 });
  }) as typeof fetch;
  return { uploads, pinata: createPinata({ PINATA_JWT: "test-jwt" }, fetchFn) };
}

/** Chain views: set_metadata present or missing, nft_token metadata reference. */
function stubViews(deps: ReturnType<typeof testDeps>, opts: { hasSetMetadata: boolean; reference?: string | null }) {
  const calls: string[] = [];
  deps.chain.view = (async (_c: string, method: string) => {
    calls.push(method);
    if (method === "set_metadata") {
      if (opts.hasSetMetadata) throw new Error("GuestPanic: Failed to deserialize input from JSON");
      const e = new Error("Contract method is not found at block height 1");
      e.name = "ContractMethodNotFoundError";
      throw e;
    }
    if (method === "nft_token") return { metadata: { reference: opts.reference ?? null } };
    if (method === "nft_tokens") return [];
    throw new Error(`unexpected view ${method}`);
  }) as Chain["view"];
  return calls;
}

function fakeSigner() {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const signer: TxSigner = {
    accountId: "brain.nearling.testnet",
    call: async (_c, method, args) => {
      calls.push({ method, args });
      return { txHash: "tx1", events: [], logs: [] };
    },
  };
  const brain: BrainSigners = { forContract: () => signer };
  return { calls, brain };
}

afterEach(() => vi.useRealTimers());

describe("buildPetMetadata", () => {
  it("contains only public fields, never nickname, time zone, owner or chat", async () => {
    const deps = testDeps();
    ensureProfile(deps.db, REF, "alice.testnet", deps.now());
    deps.db
      .prepare("UPDATE pet_profile SET nickname_enc = ?, owner_tz = ?, equipped_shirt = ?, form = 'winged' WHERE pet_ref = ?")
      .run(deps.sealer.seal(REF, "Sammy-Secret"), "Asia/Kuala_Lumpur", "3", REF);
    const built = (await buildPetMetadata(deps, REF))!;
    const json = built.json("bafkpng");
    expect(Object.keys(json).sort()).toEqual(
      ["attributes", "contract", "description", "equipped_shirt", "external_url", "form", "image", "name", "soul", "stage", "token_id", "traits"].sort(),
    );
    const text = JSON.stringify(json);
    for (const secret of ["Sammy-Secret", "Kuala_Lumpur", "alice.testnet", "care", "mood", "fuel", "device"]) {
      expect(text).not.toContain(secret);
    }
    expect(json).toMatchObject({
      name: "Mochi",
      description: SOUL,
      soul: { version: 1, prompt: SOUL },
      traits: { playful: 62, curious: 6, calm: 36, sassy: 88, kind: 17 },
      stage: "baby",
      form: "winged",
      equipped_shirt: "3",
      contract: "pets-v8.nearling.testnet",
      token_id: "1",
      image: "ipfs://bafkpng",
      external_url: "http://localhost:3000/p/pets-v8.nearling.testnet%3A1",
    });
    expect(json.attributes).toContainEqual({ trait_type: "Playful", value: 62, display_type: "number" });
    expect(built.png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("description is the first 200 bytes of the Soul, cut on a character boundary", () => {
    expect(Buffer.byteLength(utf8Prefix("é".repeat(150), 200))).toBe(200);
    expect(Buffer.byteLength(utf8Prefix("a" + "é".repeat(150), 200))).toBe(199);
  });
});

describe("syncPetMetadata", () => {
  it("is a no-op without PINATA_JWT", async () => {
    const deps = testDeps();
    const fetchFn = vi.fn();
    const pinata = createPinata({}, fetchFn as unknown as typeof fetch);
    expect(pinata.enabled).toBe(false);
    expect((await syncPetMetadata(deps, pinata, REF, createFeatureCheck(deps))).status).toBe("disabled");
    expect(fetchFn).not.toHaveBeenCalled();
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});
    const stop = startMetadataSync(deps, pinata);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("PINATA_JWT")).length).toBe(1);
    stop();
    warn.mockRestore();
  });

  it("pins PNG then JSON publicly, and re-pins only when the content changes", async () => {
    const deps = testDeps();
    stubViews(deps, { hasSetMetadata: false });
    const { uploads, pinata } = fakePinata();
    const check = createFeatureCheck(deps);

    const first = await syncPetMetadata(deps, pinata, REF, check);
    expect(first.status).toBe("pinned");
    expect(uploads.map((u) => [u.type, u.network, u.auth])).toEqual([
      ["image/png", "public", "Bearer test-jwt"],
      ["application/json", "public", "Bearer test-jwt"],
    ]);
    const row = latestMetadata(deps.db, REF)!;
    expect(row.version).toBe(1);
    expect(row.json_sha256).toBe(createHash("sha256").update(uploads[1]!.bytes).digest("hex"));
    expect(JSON.parse(uploads[1]!.bytes.toString()).image).toBe(`ipfs://${row.png_cid}`);

    const again = await syncPetMetadata(deps, pinata, REF, check);
    expect(again.status).toBe("unchanged");
    expect(uploads.length).toBe(2);

    // Soul change: JSON changes, PNG does not, so only the JSON is pinned again.
    deps.chain.getSoul = async () => ({ version: 2, prompt: "A sleepy pet." });
    deps.pets["1"] = { ...deps.pets["1"]!, soul_version: 2 };
    const soul = await syncPetMetadata(deps, pinata, REF, check);
    expect(soul.status).toBe("pinned");
    expect(uploads.map((u) => u.type)).toEqual(["image/png", "application/json", "application/json"]);
    expect(latestMetadata(deps.db, REF)!.version).toBe(2);

    // Shirt change: new look, so a new PNG and a new JSON.
    deps.db.prepare("UPDATE pet_profile SET equipped_shirt = '0' WHERE pet_ref = ?").run(REF);
    await syncPetMetadata(deps, pinata, REF, check);
    expect(uploads.length).toBe(5);
  });

  it("skips set_metadata when the contract does not have it, and checks only once", async () => {
    const deps = testDeps();
    const views = stubViews(deps, { hasSetMetadata: false });
    const { calls, brain } = fakeSigner();
    deps.brain = brain;
    const { pinata } = fakePinata();
    const check = createFeatureCheck(deps);
    await syncPetMetadata(deps, pinata, REF, check);
    deps.pets["1"] = { ...deps.pets["1"]!, stage: 2 };
    await syncPetMetadata(deps, pinata, REF, check);
    expect(calls).toEqual([]);
    expect(views.filter((m) => m === "set_metadata").length).toBe(1);
    expect(latestMetadata(deps.db, REF)!.chain_synced_at).toBeNull();
  });

  it("calls set_metadata with ipfs URIs and base64 sha256 hashes when the contract has it", async () => {
    const deps = testDeps();
    stubViews(deps, { hasSetMetadata: true });
    const { calls, brain } = fakeSigner();
    deps.brain = brain;
    const { uploads, pinata } = fakePinata();
    await syncPetMetadata(deps, pinata, REF, createFeatureCheck(deps));
    const row = latestMetadata(deps.db, REF)!;
    expect(calls).toEqual([
      {
        method: "set_metadata",
        args: {
          pet_id: "1",
          media: `ipfs://${row.png_cid}`,
          media_hash: createHash("sha256").update(uploads[0]!.bytes).digest("base64"),
          reference: `ipfs://${row.json_cid}`,
          reference_hash: createHash("sha256").update(uploads[1]!.bytes).digest("base64"),
        },
      },
    ]);
    expect(row.chain_synced_at).toBe(deps.now());
  });
});

describe("debounce and triggers", () => {
  function manualTimers() {
    const queue: { fn: () => void; ms: number }[] = [];
    const timers: Timers = { set: (fn, ms) => queue.push({ fn, ms }), clear: () => {} };
    return { queue, timers };
  }

  it("coalesces triggers per pet into one run after 60 s", async () => {
    const { queue, timers } = manualTimers();
    const run = vi.fn(async () => {});
    const d = createDebouncer(60_000, run, timers);
    d.trigger("a");
    d.trigger("a");
    d.trigger("b");
    expect(queue.map((q) => q.ms)).toEqual([60_000, 60_000]);
    queue[0]!.fn();
    expect(run).toHaveBeenCalledWith("a");
    d.trigger("a"); // after the run, a new trigger schedules again
    expect(queue.length).toBe(3);
  });

  it("bus events evolved / hatched / closet_equipped trigger a debounced re-pin", async () => {
    const deps = testDeps();
    stubViews(deps, { hasSetMetadata: false });
    const { uploads, pinata } = fakePinata();
    const { queue, timers } = manualTimers();
    const stop = startMetadataSync(deps, pinata, { timers });
    publish(REF, "evolved", { form: "winged" });
    publish(REF, "hatched", {});
    publish(REF, "closet_equipped", { equipped: "0" });
    publish(REF, "fuel_charged", {});
    expect(queue.length).toBe(1);
    queue[0]!.fn();
    await vi.waitFor(() => expect(uploads.length).toBe(2));
    stop();
  });
});

describe("GET /pets/:petRef/metadata", () => {
  it("404 before pinning, then CIDs, gateway URL and on_chain", async () => {
    const deps = testDeps();
    const { pinata } = fakePinata();
    stubViews(deps, { hasSetMetadata: false });
    const app = metadataRoutes(deps, pinata);
    expect((await app.request(`/pets/${REF}/metadata`)).status).toBe(404);
    await syncPetMetadata(deps, pinata, REF, createFeatureCheck(deps));
    const row = latestMetadata(deps.db, REF)!;

    const off = await (await metadataRoutes(deps, pinata).request(`/pets/${REF}/metadata`)).json();
    expect(off).toEqual({
      version: 1,
      json_cid: row.json_cid,
      png_cid: row.png_cid,
      gateway_url: `https://ipfs.io/ipfs/${row.json_cid}`,
      image_url: `https://ipfs.io/ipfs/${row.png_cid}`,
      pinned_at: row.pinned_at,
      on_chain: false,
    });
    stubViews(deps, { hasSetMetadata: true, reference: `ipfs://${row.json_cid}` });
    const on = await (await metadataRoutes(deps, pinata).request(`/pets/${REF}/metadata`)).json();
    expect(on.on_chain).toBe(true);
    expect((await app.request(`/pets/other.testnet:1/metadata`)).status).toBe(400);
  });

  it("uses a dedicated gateway when set", () => {
    expect(gatewayBase("https://example.mypinata.cloud/")).toBe("https://example.mypinata.cloud");
    expect(gatewayBase("example.mypinata.cloud")).toBe("https://example.mypinata.cloud");
  });
});
