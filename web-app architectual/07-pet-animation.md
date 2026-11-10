# 07. Pet animation

Every pet NFT is drawn and animated from code: the **look comes from its on-chain traits**, the **motion from a shared animation table**. The same frames run on the web (canvas) and on the device (C header), so the two bodies always match. Code: `packages/sprites`. Review page: `/dev/sprites`. Review sheets: `art/sheets/*.png`.

Why procedural: nobody owns the art yet (brain README Q4), the NFT's look should follow its chain data, and the ESP32 needs the exact same frames. Hand-drawn art can replace the poses later without changing any caller.

## 1. Format

| Item | Value |
|---|---|
| Canvas | 32×32 pixels, indexed colour, 16 entries (0 = transparent), 4 bits per pixel on the device |
| Scale | integer only: ×4 to ×6 on the web, ×6 (192 px) on the 240×240 device screen |
| Ground | the body sits on row 29, so pets of every stage stand on the same line |

Note: `CLAUDE.md` 11 suggested a 64×64 base [TBD by the art owner]. 32×32 at ×6 gives chunkier pixels on the 240 px screen and halves flash use; switch only if hand-drawn art needs the detail.

## 2. Look from traits (the NFT part)

| Trait | Drives | Rule (same in TS and C) |
|---|---|---|
| `traits[0]` | Body colour: mint, peach, sky, lemon, coral, sage, sand, rose | `traits[0] % 8` |
| `traits[2]` | Pattern: plain, belly, spots | `traits[2] % 3` |
| `stage` (chain, 0..3) | Egg, baby (small), teen, adult (big, longer sprout) | contract stage index |
| `form` (brain, Build Spec 5) | Wings drawn on the body | `winged` |

Traits are random at mint (`env::random_seed()`), so two pets almost never look the same, and anyone can recompute a pet's look from `get_pet`. The remaining traits (playful, calm, kind) are free for later: idle personality (e.g. a playful pet hops in idle).

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

- `PetSprite` (`web/components/PetSprite.tsx`): canvas 32×32, CSS integer scale, `image-rendering: pixelated`, `requestAnimationFrame` advancing by each clip's fps, palette from traits (grey for starving and dormant), `play` + `playKey` for one-shots, `onDone` callback. Reduced motion: first frame only.
- `PetScreen` (`web/components/PetScreen.tsx`): the browser Nearling: bezel + screen + care buttons (Pat, Rock, Shake, Lights off). Care is local for now; next step posts events to the brain `/care` route.
- `/dev/sprites`: every animation for any colour, pattern, stage and form. For the team, not linked in the app.

## 6. Device (hardware teammates)

`pnpm --filter @nearling/sprites export` writes:

| File | Content |
|---|---|
| `art/nearling_sprites.h` | 92 clips (egg + baby/teen/adult × base/winged), 578 frames, about 289 KB in flash as `static const` (4 bpp, high nibble = left pixel); RGB565 palettes; `nl_build_palette(traits, grey, out)`; `nl_find_clip(name, stage, winged)` |
| `art/sprites.json` | Clip metadata (name, stage, winged, fps, loop, grey, frame count) |
| `art/sheets/*.png` | Review sheets per stage and form |

Drawing on the ST7789: for each frame, decode nibbles, skip index 0 (transparent), write `palette[idx]` as a 6×6 block at (24 + x·6, 24 + y·6) into a sprite buffer, push the buffer. Swap RGB565 bytes if the display library expects it. Advance frames with `millis()` at the clip's fps (no `delay()`, `CLAUDE.md` 16). The brain sends `traits`, `stage_index`, `form` and `display_state` in `/state`.

Verified: the header compiles with `g++ -Wall -Wextra` and its decoded frames and palette checksum match the TypeScript renderer exactly.

## 7. Changing the art

Edit poses in `packages/sprites/src/animations.ts` or drawing in `pet.ts`, run `pnpm --filter @nearling/sprites test` (frames non-empty, calm loops never clipped at the frame edge, egg rules, 4 bpp packing), then `export` and send the new header to the hardware teammates. Never edit the generated header by hand.
