import { deflateSync } from "node:zlib";
import {
  SIZE, clip, paletteFor, stageFromChain, stateAnim, toRgba, type DisplayState,
} from "@nearling/sprites";

// Server-side render of a Nearling to PNG (for the OG image). Same frames as the canvas and device.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** Nearest-neighbour upscale by an integer factor (pixels stay square). */
export function upscale(rgba: Uint8ClampedArray, size: number, scale: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * scale * size * scale * 4);
  const w = size * scale;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const src = (Math.floor(y / scale) * size + Math.floor(x / scale)) * 4;
      const dst = (y * w + x) * 4;
      out[dst] = rgba[src]!;
      out[dst + 1] = rgba[src + 1]!;
      out[dst + 2] = rgba[src + 2]!;
      out[dst + 3] = rgba[src + 3]!;
    }
  }
  return out;
}

export function petPng(opts: {
  traits: readonly number[];
  stageIndex: number;
  winged: boolean;
  state: DisplayState;
  scale: number;
}): Buffer {
  const look = { stage: stageFromChain(opts.stageIndex), winged: opts.winged };
  const c = clip(stateAnim(opts.state), look);
  const frame = c.frames[0];
  const rgba = frame ? toRgba(frame, paletteFor(opts.traits, c)) : new Uint8ClampedArray(SIZE * SIZE * 4);
  const scale = Math.max(1, Math.round(opts.scale));
  return encodePng(SIZE * scale, SIZE * scale, upscale(rgba, SIZE, scale));
}
