# 07. Pet animation

Every pet NFT is drawn and animated from code: the **look comes from its on-chain traits**, the **motion from a shared animation table**. The same frames run on the web (canvas) and on the device (C header), so the two bodies always match. Code: `packages/sprites`. Review page: `/dev/sprites`. Review sheets: `art/sheets/*.png`.

Why procedural: nobody owns the art yet (brain README Q4), the NFT's look should follow its chain data, and the ESP32 needs the exact same frames. Hand-drawn art can replace the poses later without changing any caller.

## 1. Format

| Item | Value |
|---|---|
| Canvas | 32×32 pixels, indexed colour, 16 entries (0 = transparent), 4 bits per pixel on the device |
| Scale | integer only: ×4 to ×6 on the web, ×6 (192 px) on the 240×240 device screen |
| Ground | the body sits on row 29, so pets of every stage stand on the same line |

**Decision (2026-11-11, LIMITATIONS S1): we keep procedural 32×32.** `CLAUDE.md` 11 suggested a 64×64 hand-drawn base, but there is no art owner, and 32×32 at ×6 gives chunkier pixels on the 240 px screen and a quarter of the flash per frame (512 B at 4 bpp vs 2 KB). Hand-drawn art can still replace the poses later without changing any caller.

## 2. Look from traits (the NFT part)

| Trait | Drives | Rule (same in TS and C) |
|---|---|---|
| `traits[0]` | Body colour: mint, peach, sky, lemon, coral, sage, sand, rose | `traits[0] % 8` |
| `traits[2]` | Pattern: plain, belly, spots | `traits[2] % 3` |
| `stage` (chain, 0..3) | Egg, baby (small), teen, adult (big, longer sprout) | contract stage index |
| `form` (brain, Build Spec 5) | Wings drawn on the body | `winged` |

| `traits` (all five) | Personality variant of a few clips (2b) | highest trait if ≥ 50 |
| `equipped_shirt` (brain, Build Spec 5) | Closet shirt layer and its colour (2c) | token id hash % 8 |

Traits are random at mint (`env::random_seed()`, 0 to 100), so two pets almost never look the same, and anyone can recompute a pet's look from `get_pet`.

### 2b. Personality from traits

Trait order is `CLAUDE.md` 5.4: playful, curious, calm, sassy, kind. **Rule (TS `personalityFromTraits`, C `nl_personality`):** the highest trait wins if it is at least 50; ties go to the lower index; below 50 the pet has no personality and plays the default clips. Variants keep the default clip's frame count, fps and loop, so timing and the talk flow never change.

| Personality | Clip | Difference |
|---|---|---|
| playful | `idle` | crouches, then a small hop with happy eyes |
| curious | `idle` | looks left, then right (eyes shift 1 px with the highlight) |
| calm | `idle` | slow blink: half, closed, half instead of one quick blink |
| sassy | `talk` | smirk mouth, narrowed eyes on the last frame |
| kind | `pat` | two extra hearts rising |

Every other clip plays the default. Review sheet: `art/sheets/personality.png` (default row, then the variant row).

### 2c. Closet shirt layer (Build Spec 5)

The palette's 16 entries are all used, so the shirt is a **separate overlay layer per frame** with its own 4-entry palette (`SHIRT`: 0 clear, 1 cloth, 2 shade, 3 trim). `drawPet` draws it after the body and before the face: it covers the lower body from just under the mouth to the bottom, inside the outline, with a small collar of trim at the neckline and shaded pixels where the body is shaded. It is computed from the posed body, so it follows squash, hops, offsets, stage and form on every frame. Wherever the face or an effect is drawn afterwards the layer is left clear, so drawing "frame, then shirt where non-zero" keeps the order body < shirt < face < effects. Eggs have no shirt.

The shirts contract has one design (title "Nearling Shirt"), so the colour comes from the token id: `h = h * 31 + char` over the id string (uint32), colour = `h % 8` of red, blue, yellow, purple, green, orange, teal, white (tokens "0" to "7" get them in order). Grey clips (starving, dormant) grey the shirt too. API: `clip(anim, { stage, winged, shirt, personality })` returns `shirt: Bitmap[] | null`; `paletteFor(traits, clip, shirt)` adds the shirt colours; `toRgba(frame, palette, clip.shirt?.[i])` composites. Review sheet: `art/sheets/shirts.png` (8 colours × stage, form, idle / talk / starving).

## 3. Animations

| Animation | When it plays | fps | Loop | Frames |
|---|---|---|---|---|
| `idle` | `display_state` happy | 4 | yes | breathe, blink, slow wing flap |
| `sad` | `display_state` sad; reply emotion sad | 3 | yes | frown, tear runs down |
| `hungry` | `display_state` hungry; emotion hungry | 4 | yes | droop, wavy mouth, tummy rumble |
| `sleep` | `display_state` sleepy; lights off | 2 | yes | eyes closed, slow breath, Zs rise |
| `starving` | Low Fuel (chain Starving) | 2 | yes | grey palette, droop |
| `dormant` | chain Dormant | 1 | yes | grey, curled flat, wings folded, rare Z |
| `listen` | holding Talk (recording) | 4 | yes | big eyes, sound waves |
| `think` | waiting for the reply | 3 | yes | eyes up, "..." builds |
| `talk` | reply showing / voice playing | 8 | yes | mouth open and close, small bounce |
| `pat` | touch pad; emotion happy | 8 | one-shot | jump, happy eyes, cheeks, hearts |
| `rock` | rocking motion; emotion sleepy | 4 | yes | sway, drowsy eyes |
| `dizzy` | shake; emotion silly | 10 | yes | jitter, X eyes, stars |
| `eat` | fuel added (feed settled) | 8 | one-shot | food flies in, chomp, crumbs |
| `celebrate` | emotion excited; race won; paired | 10 | one-shot | big jump, sparkles |
| `evolve` | form becomes winged | 8 | one-shot | sparkles, wings grow 0 -> small -> full |
| `egg_idle` | stage egg | 3 | yes | wobble |
| `egg_hatch` | Hatch & Pair confirmed | 6 | one-shot | wobble, crack, crack, burst |

One-shots return to the state loop when they end (`then: "state"`). An egg plays egg animations only.

## 4. What plays when (shared mapping, `packages/sprites`)

```
loop    = stateAnim(display_state)          happy->idle, sad->sad, hungry->hungry, sleepy->sleep, starving, dormant
talk    = listen (holding) -> think (waiting) -> talk (reply) -> emotionAnim(emotion) -> loop
care    = careAnim(event)                    pat->pat, rock->rock, shake->dizzy, sleep->sleep
events  = fuel_added->eat, evolved->evolve, hatched->egg_hatch, race won->celebrate
```

Priority when two things happen at once: talk flow > one-shot event > care > state loop.

## 5. Web

- `PetSprite` (`web/components/PetSprite.tsx`): props `traits`, `stageIndex`, `winged`, `shirt` (equipped token id or null), `state`; personality comes from `traits`. Canvas 32×32, CSS integer scale, `image-rendering: pixelated`, `requestAnimationFrame` advancing by each clip's fps, palette from traits (grey for starving and dormant), `play` + `playKey` for one-shots, `onDone` callback. Reduced motion: first frame only.
- `PetScreen` (`web/components/PetScreen.tsx`): passes `shirt` to `PetSprite`; the pet home and the public page `/p/[petRef]` pass `PetState.equipped_shirt`. The browser Nearling: bezel + screen + care buttons (Pat, Rock, Shake, Lights off). Care is local for now; next step posts events to the brain `/care` route.
- `/dev/sprites`: every animation for any colour, pattern, stage and form. For the team, not linked in the app.

## 6. Device (hardware teammates)

`pnpm --filter @petto/sprites export` writes:

| File | Content |
|---|---|
| `art/nearling_sprites.h` | 122 clips (egg + baby/teen/adult × base/winged, plus personality variants), each with a frame list and a shirt layer list into one deduplicated pool `NL_FRAME_DATA` of 618 frames = **about 309 KB in flash** (4 bpp, high nibble = left pixel); RGB565 palettes; `nl_build_palette(traits, grey, out)`, `nl_build_shirt_palette(token_id, grey, out)`, `nl_personality(traits)`, `nl_find_clip(name, stage, winged, personality)` (falls back to the default clip) |
| `art/sprites.json` | Clip metadata (name, stage, winged, fps, loop, grey, frame count) |
| `art/sheets/*.png` | Review sheets per stage and form, plus `shirts.png` and `personality.png` |

Flash: the pool stores each distinct 512 B frame once (repeated poses, and shirt layers shared by base and winged clips), so 1574 frame references cost 618 frames. Without the shirt and personality the old header was 578 frames (289 KB); the shirt adds about 20 KB instead of doubling every clip.

Drawing on the ST7789, **draw order per frame**:
1. `c = nl_find_clip(name, stage, winged, nl_personality(traits))`; build `pal` with `nl_build_palette(traits, c->grey, pal)` and, if a shirt is equipped, `nl_build_shirt_palette(token_id, c->grey, spal)`.
2. Base layer: decode `nl_frame(c->frames[i])` nibbles, skip index 0, write `pal[idx]`.
3. Shirt layer (only if a shirt is equipped and `c->shirt` is not null): decode `nl_frame(c->shirt[i])`, skip 0, write `spal[idx]` over step 2. The face and effects are already holes in this layer, so nothing else is needed.

Each pixel is a 6×6 block at (24 + x·6, 24 + y·6) in a sprite buffer; push the buffer. Swap RGB565 bytes if the display library expects it. Advance frames with `millis()` at the clip's fps (no `delay()`, `CLAUDE.md` 16). The brain sends `traits`, `stage_index`, `form`, `equipped_shirt` and `display_state` in `/state`.

Verified with `pnpm --filter @petto/sprites check-header`: the header compiles with `g++ -std=c++17 -Wall -Wextra -Werror`, and a test program's per-clip checksums of the decoded frames and shirt layers, the body and shirt palettes, the personality rule and `nl_find_clip` fallback match the TypeScript renderer exactly (195 checks).

## 7. Changing the art

Edit poses in `packages/sprites/src/animations.ts` or drawing in `pet.ts`, run `pnpm --filter @petto/sprites test` (frames non-empty, calm loops and personality variants never clipped at the frame edge, shirt on every frame inside the pet and under the face, egg rules, 4 bpp packing), then `export`, `check-header`, look at the sheets, and send the new header to the hardware teammates. Never edit the generated header by hand.
