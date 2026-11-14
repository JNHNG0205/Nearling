// Compiles art/nearling_sprites.h with g++ -Wall -Wextra -Werror and checks that the C side decodes
// to exactly the TypeScript frames, shirt layers, palettes, shirt colours and personalities.
// Usage: pnpm --filter @petto/sprites check-header   (after `export`)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPalette, personalityFromTraits } from "../src/index";
import type { Rgb } from "../src/palette";
import { exportClips, personalityNum } from "./export";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../art");
const rgb565 = ([r, g, b]: Rgb) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);

const TRAITS: number[][] = [];
for (let t0 = 0; t0 < 8; t0++) for (let t2 = 0; t2 < 3; t2++) TRAITS.push([t0, 0, t2, 0, 0]);
const PERSONA: number[][] = [[90, 10, 10, 10, 10], [10, 80, 80, 10, 10], [0, 0, 0, 0, 50], [49, 49, 49, 49, 49], [3, 20, 60, 99, 98], [0, 0, 0, 0, 0]];
const TOKENS = ["0", "1", "2", "7", "8", "10", "42", "123456", "nearling"];

const C_SRC = `
#include <cstdio>
#include "nearling_sprites.h"
static uint32_t fnv(uint32_t h, uint8_t v) { return (h ^ v) * 16777619u; }
static uint32_t hash_frames(const uint16_t* ids, int n) {
  uint32_t h = 2166136261u;
  for (int f = 0; f < n; f++) {
    const uint8_t* d = nl_frame(ids[f]);
    for (int i = 0; i < NL_FRAME_BYTES; i++) { h = fnv(h, d[i] >> 4); h = fnv(h, d[i] & 15); }
  }
  return h;
}
int main() {
  for (int i = 0; i < NL_CLIP_COUNT; i++) {
    const nl_clip_t* c = &NL_CLIPS[i];
    std::printf("clip %s %d %d %d %d %d %d %d %u %u\\n", c->name, c->stage, c->winged, c->personality, c->fps, c->loop, c->grey,
      c->frame_count, hash_frames(c->frames, c->frame_count), c->shirt ? hash_frames(c->shirt, c->frame_count) : 0u);
  }
  const uint8_t traits[][5] = { ${TRAITS.map((t) => `{${t.join(",")}}`).join(", ")} };
  for (const auto& t : traits) for (int g = 0; g < 2; g++) {
    uint16_t out[16]; nl_build_palette(t, g == 1, out);
    std::printf("pal");
    for (int i = 1; i < 16; i++) std::printf(" %u", out[i]);
    std::printf("\\n");
  }
  const char* tokens[] = { ${TOKENS.map((t) => `"${t}"`).join(", ")} };
  for (const char* t : tokens) for (int g = 0; g < 2; g++) {
    uint16_t out[4]; nl_build_shirt_palette(t, g == 1, out);
    std::printf("shirt %u %u %u\\n", out[1], out[2], out[3]);
  }
  const uint8_t persona[][5] = { ${PERSONA.map((t) => `{${t.join(",")}}`).join(", ")} };
  for (const auto& t : persona) std::printf("persona %u\\n", nl_personality(t));
  const nl_clip_t* a = nl_find_clip("idle", 3, 1, 1);
  const nl_clip_t* b = nl_find_clip("sad", 3, 1, 1);
  const nl_clip_t* e = nl_find_clip("egg_idle", 0, 1, 2);
  std::printf("find %d %d %s\\n", a ? a->personality : -1, b ? b->personality : -1, e ? e->name : "null");
  return 0;
}
`;

function fnvFrames(frames: Uint8Array[]): number {
  let h = 2166136261;
  for (const f of frames) for (const v of f) h = Math.imul(h ^ v, 16777619) >>> 0;
  return h;
}

const expected: string[] = [];
for (const c of exportClips()) {
  const k = c.clip;
  expected.push(
    `clip ${c.anim} ${{ egg: 0, baby: 1, teen: 2, adult: 3 }[c.stage]} ${c.winged ? 1 : 0} ${personalityNum(c.personality)} ${k.fps} ${k.loop ? 1 : 0} ${k.palette === "grey" ? 1 : 0} ${k.frames.length} ${fnvFrames(k.frames)} ${k.shirt ? fnvFrames(k.shirt) : 0}`,
  );
}
for (const t of TRAITS) {
  for (const g of ["normal", "grey"] as const) expected.push(`pal ${buildPalette(t, g).rgb.slice(1).map(rgb565).join(" ")}`);
}
for (const t of TOKENS) {
  for (const g of ["normal", "grey"] as const) expected.push(`shirt ${buildPalette([0], g, t).shirt!.slice(1).map(rgb565).join(" ")}`);
}
for (const t of PERSONA) expected.push(`persona ${personalityNum(personalityFromTraits(t))}`);
expected.push("find 1 0 egg_idle");

const dir = mkdtempSync(join(tmpdir(), "nl-header-"));
try {
  writeFileSync(join(dir, "check.cpp"), C_SRC);
  execFileSync("g++", ["-std=c++17", "-Wall", "-Wextra", "-Werror", "-I", ART, "-o", join(dir, "check"), join(dir, "check.cpp")], { stdio: "inherit" });
  const got = execFileSync(join(dir, "check"), { encoding: "utf8", maxBuffer: 64 << 20 }).trim().split("\n");
  let bad = 0;
  for (let i = 0; i < Math.max(got.length, expected.length); i++) {
    if (got[i] !== expected[i]) {
      if (bad++ < 10) console.error(`line ${i}\n  C:  ${got[i]}\n  TS: ${expected[i]}`);
    }
  }
  if (bad) {
    console.error(`${bad} mismatches`);
    process.exit(1);
  }
  console.log(`header OK: compiled with -Wall -Wextra -Werror; ${got.length} checks match the TypeScript renderer`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
