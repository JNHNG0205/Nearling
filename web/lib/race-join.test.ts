import { afterEach, describe, expect, it, vi } from "vitest";
import { joinRoom } from "./race";

afterEach(() => vi.unstubAllGlobals());

describe("joinRoom", () => {
  it("makes one join request per room even when called twice at once (double mount)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ race_token: "t1", slot: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([joinRoom("ABCDEF"), joinRoom("ABCDEF")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("forgets a failed join so the user can retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "upstream", message: "x" } }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ race_token: "t2", slot: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(joinRoom("GHJKLM")).rejects.toBeTruthy();
    await expect(joinRoom("GHJKLM")).resolves.toEqual({ race_token: "t2", slot: 0 });
  });
});
