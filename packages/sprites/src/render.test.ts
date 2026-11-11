import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderPetPng } from "./render";

function decode(png: Buffer): { w: number; h: number; rgba: Buffer } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) raw.copy(rgba, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return { w, h, rgba };
}

const base = { traits: [10, 20, 30, 40, 50], stageIndex: 2, winged: false, shirt: null, scale: 4 };

describe("renderPetPng", () => {
  it("renders a scaled PNG with a transparent background and a visible pet", () => {
    const { w, h, rgba } = decode(renderPetPng(base));
    expect([w, h]).toEqual([128, 128]);
    expect(rgba[3]).toBe(0);
    let opaque = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 255) opaque++;
    expect(opaque).toBeGreaterThan(100);
  });

  it("brand background fills every pixel", () => {
    const { rgba } = decode(renderPetPng({ ...base, background: "brand" }));
    expect([...rgba.subarray(0, 4)]).toEqual([0x0c, 0x0a, 0x08, 255]);
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(255);
  });

  it("is deterministic and changes with the look", () => {
    const a = renderPetPng(base);
    expect(renderPetPng(base).equals(a)).toBe(true);
    expect(renderPetPng({ ...base, winged: true }).equals(a)).toBe(false);
    expect(renderPetPng({ ...base, shirt: "0" }).equals(a)).toBe(false);
    expect(renderPetPng({ ...base, stageIndex: 0 }).equals(a)).toBe(false);
    expect(renderPetPng({ ...base, traits: [11, 20, 30, 40, 50] }).equals(a)).toBe(false);
  });
});
