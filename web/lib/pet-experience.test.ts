import { describe, expect, it, vi } from "vitest";
import { receiptChecks } from "@/components/talk/receiptChecks";
import { talkAnim, turnFromTalk } from "@/components/nearling/talkFlow";
import { formatNear, timelineLine } from "@/components/nearling/timeline";
import { fuelSegments, thoughts } from "@/components/FuelMeter";
import {
  BrainRequestError, normalizeAttestation, normalizeInbox, normalizeTimeline, normalizeTurn, type Receipt,
} from "./brain";
import { FailedTurn, withOneRetry } from "./useTalk";

describe("withOneRetry", () => {
  it("retries once after a network error, then succeeds", async () => {
    const send = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce("ok");
    await expect(withOneRetry(send, 1000)).resolves.toBe("ok");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("retries once after a timeout", async () => {
    let calls = 0;
    const send = (signal: AbortSignal) => {
      calls++;
      if (calls === 1) {
        return new Promise<string>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      return Promise.resolve("saved reply");
    };
    await expect(withOneRetry(send, 10)).resolves.toBe("saved reply");
    expect(calls).toBe(2);
  });

  it("gives up after the second failure", async () => {
    const send = vi.fn().mockRejectedValue(new TypeError("offline"));
    await expect(withOneRetry(send, 1000)).rejects.toThrow("offline");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("retries a failed generation once (same request_id) and gives up after two", async () => {
    const send = vi.fn().mockRejectedValue(new FailedTurn());
    await expect(withOneRetry(send, 1000)).rejects.toBeInstanceOf(FailedTurn);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not retry brain errors", async () => {
    const send = vi.fn().mockRejectedValue(new BrainRequestError(429, "rate_limited", 3));
    await expect(withOneRetry(send, 1000)).rejects.toBeInstanceOf(BrainRequestError);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeTurn", () => {
  it("reads the documented shape", () => {
    const t = normalizeTurn({
      turn_id: "t1", at: 5, user_text: "hi", reply: "hello", emotion: "excited",
      fuel: { status: "settled", tx: "8Fh2", source: "food" }, verification: { status: "model_verified" },
    });
    expect(t).toMatchObject({ turn_id: "t1", emotion: "excited", fuel: { status: "settled", tx: "8Fh2", source: "food" }, verification: "model_verified" });
  });

  it("reads table column names and falls back safely", () => {
    const t = normalizeTurn({ id: "t2", created_at: 9, reply_text: "zzz", emotion: "grumpy", tx_hash: "abc", verification: "weird" });
    expect(t).toMatchObject({ turn_id: "t2", at: 9, reply: "zzz", emotion: "happy", fuel: { status: "settled", tx: "abc" }, verification: "pending" });
  });

  it("rejects rows without an id", () => {
    expect(normalizeTurn({ reply: "x" })).toBeNull();
  });
});

describe("talk flow", () => {
  it("maps phases to sprites", () => {
    expect(talkAnim("listening", "happy")).toBe("listen");
    expect(talkAnim("thinking", "happy")).toBe("think");
    expect(talkAnim("talking", "happy")).toBe("talk");
    expect(talkAnim("reacting", "silly")).toBe("dizzy");
    expect(talkAnim("idle", "happy")).toBeNull();
  });

  it("builds a pending turn from a talk reply", () => {
    const local = { localId: "l1", requestId: "r1", text: "how are you", at: 1 };
    const t = turnFromTalk(local, {
      turn_id: "t9", status: "done", reply: "Great", emotion: "happy",
      fuel: { left: 21, charged: "pending" }, audio_url: null, receipt_url: null,
    });
    expect(t).toMatchObject({ turn_id: "t9", user_text: "how are you", fuel: { status: "pending" }, verification: "pending" });
  });

  it("marks canned Low Fuel replies as free and keys them locally", () => {
    const local = { localId: "l2", requestId: "r2", text: "hi", at: 1 };
    const t = turnFromTalk(local, {
      turn_id: null, status: "canned", reply: "zzz", emotion: "sleepy", fuel: { left: 0 }, audio_url: null, receipt_url: null,
    });
    expect(t).toMatchObject({ turn_id: "l2", status: "canned", fuel: { status: "none" } });
  });
});

describe("receiptChecks", () => {
  const base: Receipt = {
    turn_id: "t", pet_ref: "pets-demo.nearling.testnet:0", at: 0, soul_version: 2, model: "m",
    verification: { status: "model_verified", signer: "0x3f1a00000000c09", req_hash: "9b2e00000000", resp_hash: "41ac00000000",
      attestation: { fetched_at: 0, nras: "pass", tdx: "not checked in app" } },
    fuel: { cost_micro: 1000, source: "food", tx: "8Fh2" },
  };

  it("lists passed checks and what is not checked", () => {
    const c = receiptChecks(base, 12 * 60_000);
    expect(c.map((x) => x.state)).toEqual(["ok", "ok", "ok", "not_checked", "not_checked", "not_checked"]);
    expect(c[0]!.text).toContain("12 min ago");
  });

  it("shows the reason when unverified", () => {
    const c = receiptChecks({ ...base, verification: { status: "unverified", reason: "signer mismatch", attestation: null } });
    expect(c[0]!.state).toBe("fail");
    expect(c[1]).toEqual({ state: "fail", text: "Signature did not check out: signer mismatch" });
  });
});

describe("small helpers", () => {
  it("formats NEAR", () => {
    expect(formatNear("500000000000000000000000")).toBe("0.5");
    expect(formatNear("12345000000000000000000000")).toBe("12.345");
    expect(formatNear(null)).toBe("0");
  });

  it("writes timeline lines", () => {
    const t = normalizeTimeline({ kind: "fed", actor: "bob.testnet", amount: "100000000000000000000000", block_ts: 3 }, 0)!;
    expect(timelineLine(t)).toBe("Fed by bob.testnet (0.1 NEAR)");
    expect(timelineLine(normalizeTimeline({ kind: "soul_updated", amount: "3", at: 1 }, 1)!)).toBe("Soul updated to v3");
    expect(timelineLine(normalizeTimeline({ id: 7, kind: "stage_up", actor: null, amount: "2", at: 1 }, 2)!)).toBe("Grew up to teen");
    expect(timelineLine(normalizeTimeline({ id: 8, kind: "fed", actor: null, amount: "1000000000000000000000000", at: 1 }, 3)!)).toBe("Fed (1 NEAR)");
  });

  it("normalises inbox and attestation", () => {
    expect(normalizeInbox({ id: "4", text: "I missed you" })).toMatchObject({ id: 4, text: "I missed you" });
    expect(normalizeInbox({ id: 1 })).toBeNull();
    expect(normalizeAttestation({ models: [{ model: "m", fetched_at: 1, fresh: true, nras: "pass", model_signers: [] }] })[0]).toMatchObject({ model: "m", ok: true, nras: "pass" });
    expect(normalizeAttestation({ models: [{ model: "m", fetched_at: 1, fresh: false, nras: "pass" }] })[0]!.ok).toBe(false);
    expect(normalizeAttestation({ "z-ai/glm": { ok: 1, fetched_at: 7, model_signers: ["0xabc"] } })).toEqual([
      { model: "z-ai/glm", fetched_at: 7, ok: true, nras: null, signers: ["0xabc"], gateway_signer: null },
    ]);
  });

  it("fills fuel segments and pluralises thoughts", () => {
    const fuel = { left: 22, price_micro: 1000, budget_micro: 22_000, daily_burn_micro: 100_000, low: false };
    expect(fuelSegments(fuel)).toBe(1);
    expect(fuelSegments({ ...fuel, budget_micro: 300_000 })).toBe(10);
    expect(fuelSegments({ ...fuel, budget_micro: 0 })).toBe(0);
    expect(thoughts(1)).toBe("1 thought");
    expect(thoughts(0)).toBe("0 thoughts");
  });
});
