# Nearling design system (pixel)

Written 2026-11-10 with **taste-skill v2.5.1** (`design-taste-frontend`, installed at `~/.claude/skills/design-taste-frontend`). The skill was used for what it is good at: the kind, the dealt palette, copy rules, layout discipline, motion and the checklist. Where its defaults fight the brief ("pixel vibe"), this file says so and why. Applies to `web/` and to the Figma file once Figma is reconnected. Pages and flows: [03-pages-and-flows.md](03-pages-and-flows.md).

## 1. The deal

| Item | Value | Source |
|---|---|---|
| Kind | **gaming** (page type software, site-kind gaming): a game with a hardware body | skill section 1 table |
| Palette | **warm-black-gold**: bg `#0c0a08`, surface `#181512`, ink `#ffffff`, muted `#8f8a84`, accent `#c9a45a` | `start.mjs deal --page gaming --trade "pixel art virtual pet game"`, first palette |
| Why it fits | A near-black ground is the device's own screen: the ST7789 shows pixels on black, so the web and the desk body look like one object. Gold reads as the pet's fuel (NEAR it eats) and stays warm and friendly, not neon | plan line 2 |
| Dealt type | Bricolage Grotesque + Figtree + DM Mono | `start.mjs deal`, first pairing |
| Type used | **Pixelify Sans** (display), **Figtree** (text), **DM Mono** (numbers, hashes) | deviation 1 |
| Radius | **square (0)** | deviation 2 |
| Effect | none (no shader, no WebGL); the pixel pet itself is the moving visual | deviation 3 |

### Deviations from the skill, on purpose

1. **Pixel display face instead of the dealt grotesk.** The brief is "pixel vibe". Pixelify Sans (Google Fonts, weights 400 to 700) carries the wordmark, headings, the pet UI and stat labels. Figtree from the dealt pairing stays for every sentence a person reads, because pixel fonts tire the eye in paragraphs. Bricolage stays as the fallback if Pixelify fails a readability check at 16 px.
2. **Square corners.** The skill says `soft` by default and `round` for consumer apps. Pixel art has no curves; every box, button and frame is square with 2 px hard borders.
3. **No shader effect or scene on the landing page.** The skill allows one effect on gaming pages. A pixel canvas with the live demo pet does that job and costs no WebGL context on a phone.
4. **The app pages are not a marketing page.** "One section per screen" and the 1440 rules apply to the landing page (`/`) and the public pet page (`/p/[petRef]`). App pages (`/pet/*`, `/hatch`, `/feed`, `/receipt`, `/approve`, `/race`) follow section 5, a phone-first game UI.
5. **Pet dialogue is exempt from the copy bans.** The skill bans exclamation marks, slang and jokes in UI copy, and we keep that for labels, buttons and headings. Lines the pet says are character voice from the model and the Soul, and may be playful.

## 2. Tokens

The `:root` block below is the skill's printed block (kept as printed) plus Nearling additions under `--n-*`. Put it in `web/app/globals.css`; mirror it as Figma variables (section 8).

```css
:root {
  /* dealt by taste-skill: warm-black-gold */
  --p-bg: #0c0a08; --p-surface: #181512; --p-ink: #ffffff; --p-muted: #8f8a84;
  --p-accent: #c9a45a; --p-accent-ink: #0c0a08; --p-action: #c9a45a; --p-action-ink: #0c0a08;
  --p-inv-bg: #ffffff; --p-inv-surface: #ebebeb; --p-inv-ink: #0c0a08; --p-inv-muted: #5c5b59;

  /* Nearling: pixel surfaces */
  --n-surface-2: #231f1a;          /* raised panel, device bezel */
  --n-line: #3a332b;               /* 2 px borders */
  --n-shadow: #000000;             /* hard offset shadow, never blurred */
  --n-screen: #0f140c;             /* the device LCD inside the bezel */

  /* Nearling: game states (each checked against --p-bg, section 7) */
  --n-fuel: #9ad46a;               /* fuel bar, happy */
  --n-warn: #e8913a;               /* low fuel, hungry */
  --n-danger: #e25c4f;             /* starving, errors */
  --n-sleep: #7a8fd6;              /* sleepy, dormant */
  --n-verified: #9ad46a;           /* Model verified */
  --n-gateway: #6fb7e0;            /* Gateway verified */
  --n-unverified: #e8913a;         /* Unverified */
  --n-demo: #c9a45a;               /* demo speed pill (accent) */

  /* type */
  --font-display: "Pixelify Sans", "Bricolage Grotesque", system-ui, sans-serif;
  --font-text: "Figtree", system-ui, sans-serif;
  --font-mono: "DM Mono", ui-monospace, Menlo, monospace;

  /* pixel grid: everything is a multiple of 4 px */
  --n-u: 4px;
  --n-border: 2px;
  --n-shadow-off: 4px;             /* box-shadow: 4px 4px 0 var(--n-shadow) */
  --n-radius: 0;
}
```

No violet anywhere (skill rule: violet means deal again).

## 3. Type scale

| Role | Font | Size / line height | Use |
|---|---|---|---|
| Wordmark | Pixelify 700 | 32 / 32 | Nav, splash |
| h1 | Pixelify 600 | 40 / 44 (phone 32 / 36) | Landing hero, page titles |
| h2 | Pixelify 500 | 28 / 32 (phone 24 / 28) | Section headings |
| Label | Pixelify 500 | 14 / 16, tracking 0.02em | Stat labels, pills, buttons |
| Body | Figtree 400 | 16 / 24 | Every sentence |
| Small | Figtree 400 | 14 / 20 | Help text |
| Data | DM Mono 400 | 14 / 20 | Fuel numbers, tx and hashes, receipt fields |
| Pet speech | Pixelify 400 | 18 / 24 | Speech bubbles on the pet screen |

Sentence case everywhere; no all-caps labels (skill rule). Minimum text size 14 px; body never below 16 px on phones. Pixel font sizes are multiples of 4 px, except the 14 px label size, which still renders crisp in Pixelify.

## 4. Pixel rules

- **Sprites:** 32×32 procedural pets ([07-pet-animation.md](07-pet-animation.md)), drawn at **integer scale only** (×2, ×3, ×4) with `image-rendering: pixelated`. Never a fractional scale (uneven pixels).
- **Device screen:** the browser Nearling is a 240×240 canvas inside a bezel (`--n-surface-2`, 2 px `--n-line`, 4 px hard shadow). It scales to the largest integer that fits: ×1 under 520 px wide, ×2 above. On a phone the pet home shows the screen at ×1 with the controls under it, like holding the device.
- **Borders and shadows:** 2 px solid borders; shadow `4px 4px 0 #000`, never blurred, never a glow.
- **Icons:** 16×16 pixel icons on a 1 px grid (fuel drop, heart, moon, shirt, wing, seed, coin, check, warning), drawn by the art owner or taken from a pixel set with a licence listed in the README. Wallet and chain logos (NEAR, Meteor) use their real marks, as the skill asks for known products.
- **Dither, not gradients:** depth comes from 2-colour dither patterns or flat steps. No CSS gradients, no blur, no glassmorphism.
- **Grid:** 4 px base, content gutters 16 px on phones, 24 px on tablets, `.wrap` max 1200 px on the landing page, 480 px on app pages.

## 5. Components

| Component | Spec | Hover / press (skill rule 5) |
|---|---|---|
| `PixelButton` primary | Gold `--p-action` fill, `--p-action-ink` Pixelify 500 16 px, 2 px black border, 4 px hard shadow, 48 px tall | Hover: lifts 2 px (shadow grows to 6 px). Press: moves down 4 px, shadow 0 |
| `PixelButton` secondary | Surface fill, ink text, 2 px `--n-line` border | Same motion |
| `FuelMeter` | 10 segment blocks (each 10% of a 3-day budget, like `fullness`), colour by state: fuel / warn / danger; label "22 thoughts" in DM Mono | Segments drop one by one when a thought is paid; a feed fills them left to right |
| `StatePill` | Pixel pill: icon + word ("Hungry", "Low fuel", "Sleepy"), colour from section 2 | none |
| `DemoSpeedPill` | Gold outline, "demo speed" | none |
| `NearlingFrame` | Bezel + 240×240 screen + three pixel buttons drawn under it (Talk, Feed, Menu) mirroring the device | Buttons press like the real ones |
| `SpeechBubble` | Pixel bubble (stepped corners, tail), Pixelify 18 px, typewriter reveal at 40 chars/s (instant with reduced motion) | none |
| `ReceiptBadge` | Square chip under a reply: check + "Model verified" (green) / "Gateway verified" (blue) / "Unverified" (amber) + "1 thought" | Lifts 2 px; opens the receipt |
| `TxStatus` | Mono line "charging..." -> "paid . 8Fh2..." with explorer link | Underline draws on hover |
| `PackCard` | Feed pack: pixel food icon, "Meal", "100 thoughts", price | Linked card lifts 2 px |
| `ShirtCard` | Shirt sprite on a surface tile, "Wear" button | Photo-style zoom 1.03 inside its frame |
| `GardenPlot` | Seed sprite that grows with stake; credit ticker in DM Mono | none |
| `RaceCanvas` | Two lanes, 240×240 logical, integer scale, both pets | n/a |

Labels follow the skill's button rule (a verb plus what you get): "Hatch my pet", "Feed Mochi", "Claim a shirt", "Plant NEAR", "Sign in Meteor", "Start a race", "See the receipt". Never "Learn more", "Discover" or "Click here".

## 6. Screens

### 6.1 Landing `/` (skill rules apply in full)

One section per screen at 1440×900, equal edges, hero alone on the first screen, hero enters once on load, one dealt moment.

| # | Section | Idea | Visual |
|---|---|---|---|
| 1 | Hero | h1 "Nearling, a pixel pet that pays for its own AI" (name and genre); hard fact under it: "Every reply costs $0.001 of private AI, paid from the pet's own NEAR budget on testnet." Buttons: **Hatch a pet** (main), Watch the demo pet | The live demo pet from `pets-demo` in a `NearlingFrame`, fuel visibly dropping (the key art) |
| 2 | How it works | "Feed it NEAR, it thinks, it pays" as 3 pixel steps: Feed, Talk, Pay | Three sprites in a row |
| 3 | The body | "A desk Nearling you pat, rock and race" | Photographs of the real 3D-printed device (from the hardware teammates); stand-in: the bezel render until photos exist |
| 4 | Private replies | "Every reply comes with a receipt": a real receipt card | `ReceiptBadge` + receipt card |
| 5 | Brain Garden | "Plant 10 NEAR and it feeds itself": credit ticker, self-sustaining badge | `GardenPlot` |
| 6 | Close | Wordmark large + **Hatch a pet** | type moment |

Dealt moment: section 1 entrance (the egg cracks once on load) and section 5 type moment (the credit number counts up once when in view). Footer: links, "Built at NEAR HACKATHON", licence credits in one line.

### 6.2 App screens (phone first, 390 wide)

```
Pet home                         Feed the Brain                Receipt
+---------------------------+    +---------------------------+  +---------------------------+
| Nearling   [demo speed] o |    | < Feed Mochi              |  | < Receipt                 |
| +-----------------------+ |    | [sprite] 4 thoughts left  |  | [v] Model verified        |
| |  240x240 screen       | |    | +--------+ +--------+     |  | Soul v2 . glm-5.3-flash   |
| |   pet + bubble        | |    | | Snack  | | Meal   |     |  | GPU attestation  ok       |
| +-----------------------+ |    | | 20     | | 100    |     |  | Signed by 0x3f1a..c09     |
|  [Talk]  [Feed]  [Menu]   |    | +--------+ +--------+     |  | req 9b2e.. resp 41ac..    |
| Fuel [######----] 22      |    | Pay with                  |  | 1 thought . food . 8Fh2.. |
| Mood <3<3<3  wings: o o o |    | [NEAR wallet] [Other chain]|  | Voice: ElevenLabs (note)  |
| Pat  Rock  Shake  Lights  |    | [ Feed Mochi 0.5 NEAR ]   |  | [Publish this receipt]    |
| -- chat --                |    +---------------------------+  +---------------------------+
| you: hi                   |
| Mochi: Hi! ...  [v][1]    |
+---------------------------+
```

Hatch & Pair, Closet, Garden, Approve and Race follow the same frame: back arrow + title (Pixelify 24), one main `PixelButton` pinned at the bottom of the phone screen, content in 16 px gutters. State per screen and copy: [05-ux-copy-and-states.md](05-ux-copy-and-states.md).

## 7. Accessibility

| Colour | On bg `#0c0a08` | On surface `#181512` | Use |
|---|---|---|---|
| ink `#ffffff` | 19.8:1 | 18.2:1 | text |
| muted `#8f8a84` | 5.8:1 | 5.3:1 | secondary text |
| accent `#c9a45a` | 8.4:1 | 7.7:1 | links, accents |
| fuel / verified `#9ad46a` | 11.3:1 | 10.4:1 | meter, verified |
| warn `#e8913a` | 8.0:1 | 7.4:1 | low fuel, unverified |
| danger `#e25c4f` | 5.5:1 | 5.1:1 | errors (always with an icon and a word) |
| sleep `#7a8fd6` | 6.3:1 | 5.8:1 | sleepy, dormant |
| gateway `#6fb7e0` | 9.0:1 | 8.2:1 | Gateway verified |
| action-ink `#0c0a08` on action `#c9a45a` | 8.4:1 | | primary buttons |

All pass WCAG AA (4.5:1) for normal text, computed with the WCAG 2 formula. Colour is never the only signal: every state pill has an icon and a word. Touch targets ≥ 44 px. `prefers-reduced-motion`: no typewriter, no bounce, no confetti, sprites hold their first frame. Every audio reply also shows its text.

## 8. Figma (when the connector is back)

- **Variables:** collection "Nearling" with the section 2 tokens (colour, number for spacing and borders), modes: default only.
- **Text styles:** section 3 rows.
- **Components:** section 5 list, with hover and press variants.
- **Frames:** 1440 and 390 for the landing page; 390 for each app screen in 6.2 plus Hatch & Pair, Closet, Garden, Approve, Race, Low Fuel and Dormant states.
- The code tokens in `globals.css` are the source of truth; Figma mirrors them.

## 9. Checks

- **copy-lint** (no browser needed) on the landing copy before shipping: `node ~/.claude/skills/design-taste-frontend/scripts/copy-lint.mjs <file> --kind gaming`.
- **The skill's finish gate and layout checks need Chrome or Chromium**, which this machine does not have, and they target static pages. For the Next.js landing page, build a static export of `/` and run `consistency.mjs` and `check.mjs` against it once Chrome is installed. Until then: manual review at 1440, 1024, 768 and 390 against the skill's checklist (section 5 of its SKILL.md).
- Do **not** run `start.mjs` inside the repo without meaning to: it arms the skill's gate, whose Stop hook then blocks finishing until the page passes.
