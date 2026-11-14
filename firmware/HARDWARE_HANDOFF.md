# Petto hardware handoff (for the firmware / integration work)

Put this file in the repo at `firmware/HARDWARE_HANDOFF.md`. It is the source of truth for **the physical device as it was actually built**. Where it disagrees with `firmware/include/board_config.h` or `docs/hardware/*`, **this file wins**: those were written for an earlier breadboard plan (OLED, different pins, touch + light sensor).

Read together with:
- `docs/hardware/DEVICE_PROTOCOL.md`: every brain call, in order (hello → pairing → state → talk → care → inbox → actions → battles §10).
- **Game: the race ("Petto Run") was removed on 14 Nov and replaced by a turn-based Pet Battle.** Study it yourself in the codebase (section 12 below). Ignore anything about the race, lanes or `race/ws` in older docs.
- `docs/hardware/DEVICE_SIGNING.md`: device-key signing (stretch).
- Button roles follow the repo's original 3-button scheme (A left/back, B select/hold-to-talk/hold-to-approve/lane, C right/menu). `firmware/TWO_BUTTON_CONTROLS.md` is now only a fallback if a button fails on stage.
- `web/app/device-sim/page.tsx`: a browser device that already follows the protocol end to end. Copy its flow.

Deadline: **14 Nov 2026 23:59 UTC = Sun 15 Nov 07:59 Malaysia time.** Optimize for a working demo, not completeness.

---

## 1. Board and toolchain

| Item | Value |
|---|---|
| MCU board | ESP32-S3-WROOM-1 **N16R8** dev board (two USB-C ports, "ESP32-S3 WROOM" CAM-style board) |
| Flash / PSRAM | 16 MB flash, **8 MB OPI PSRAM** (must be enabled, or PSRAM reads 0 KB) |
| Upload port | the **UART / CH343** USB-C port. Windows **COM9** (check Device Manager) |
| Arduino core | esp32 core **3.x** (uses `ESP_I2S.h` / `I2SClass`, `rgbLedWrite`) |
| Arduino IDE settings | Board **ESP32S3 Dev Module**, PSRAM **OPI PSRAM**, Flash Size **16MB**, Partition with ≥3 MB app (e.g. "16M Flash (3MB APP/9.9MB FATFS)"), USB CDC On Boot: Disabled (we use the UART port) |
| PlatformIO (repo) | `firmware/platformio.ini`. Make sure it has `board_build.arduino.memory_type = qio_opi`, `board_upload.flash_size = 16MB`, `build_flags = -DBOARD_HAS_PSRAM`, and the same partition |
| Host | **Windows native** (not WSL: WSL can't see COM9). Claude Code + PlatformIO / arduino-cli on Windows |

**Pins to never use:** 35, 36, 37 (PSRAM), 0, 3, 45, 46 (strapping), 19, 20 (USB OTG), 38, 39, 40 (SD slot on this board), 48 (on-board RGB LED).

## 2. Final pin map (as soldered)

| Function | Part | Pins | Notes |
|---|---|---|---|
| Display | ST7789 **240×240** 1.3" IPS "GMT130", **no CS pin** | SCL/SCLK **12**, SDA/MOSI **11**, RES **10**, DC **9**, BLK **14** | SPI with CS = -1. **SPI_MODE3** (try MODE0 if the screen stays black). 40 MHz is fine. Backlight: HIGH = on (PWM OK) |
| Mic | INMP441 I2S | SCK **5**, WS **6**, SD **7**, L/R → GND | left slot. 3V3 power |
| Amp | MAX98357A I2S | BCLK **15**, LRC **16**, DIN **17** | VIN = **5V**, GAIN → VIN (+6 dB), SD unconnected |
| Speaker | **8 Ω 0.5 W** | amp + / − | never to GND |
| IMU | MPU6050 (GY-521) | I2C SDA **1**, SCL **2**, addr **0x68** | 3V3. WHO_AM_I may read 0x68/0x70/0x72/0x98 (clones); accept any if data moves |
| Button A | 7 mm red push button | **GPIO 18** | left. Back / previous. To GND, INPUT_PULLUP, active LOW |
| Button B | 7 mm red push button | **GPIO 8** | middle. Select, **hold to talk**, hold 2 s to approve |
| Button C | 7 mm red push button | **GPIO 13** | right. Next / menu |
| Touch sensor | TTP223 | — | **REMOVED** |
| Light sensor | BH1750 / GY-30 | — | **REMOVED** |
| On-board RGB LED | WS2812 | 48 | optional status light (`rgbLedWrite(48, r, g, b)`) |

### `board_config.h` must become

```c
// Display ST7789 240x240, SPI, no CS
#define PIN_TFT_SCLK 12
#define PIN_TFT_MOSI 11
#define PIN_TFT_RST  10
#define PIN_TFT_DC    9
#define PIN_TFT_BLK  14
#define TFT_SPI_MODE SPI_MODE3
#define TFT_W 240
#define TFT_H 240
// Mic INMP441
#define PIN_MIC_SCK   5
#define PIN_MIC_WS    6
#define PIN_MIC_SD    7
#define MIC_SAMPLE_HZ 16000
// Amp MAX98357 (VIN on 5V, GAIN->VIN = +6 dB), 8 ohm 0.5 W speaker
#define PIN_AMP_BCLK 15
#define PIN_AMP_LRC  16
#define PIN_AMP_DIN  17
#define AMP_VOLUME_MAX 0.6f   // ~0.4 W into 8 ohm at +6 dB. Do NOT move GAIN to GND with this speaker
// I2C
#define PIN_I2C_SDA 1
#define PIN_I2C_SCL 2
#define MPU_ADDR 0x68
// Buttons: all three working, to GND, INPUT_PULLUP, active LOW
#define PIN_BTN_A 18   // left: back / previous (battle menu: up)
#define PIN_BTN_B  8   // middle: select, hold-to-talk, hold-to-approve (battle: select)
#define PIN_BTN_C 13   // right: next / menu (battle menu: down)
#define BTN_DEBOUNCE_MS 25
#define BTN_HOLD_MS    400
#define BTN_LONG_MS    800
#define APPROVE_HOLD_MS 2000
#define BOTH_HOLD_MS   3000
// Removed: PIN_TOUCH, BH1750
```

## 3. Power

LiPo **802535 (800 mAh, ~38×25×7 mm)** → **TP4056 USB-C** charger (B+/B−, OUT+/OUT−) → **rocker switch** → **MT3608** boost set to **5.0 V** → ESP32 **5V pin** + amp VIN. Everything else runs from the ESP32's 3V3.

- **Turn the rocker OFF when USB is plugged into the ESP32** (otherwise USB 5V and the MT3608 output fight).
- The TP4056 USB-C is only for **charging**. Upload and serial use the ESP32's own UART USB-C.
- No battery-voltage sense pin is wired, so the firmware cannot read battery %. Don't show a fake battery level.
- Brown-out risk: loud audio peaks plus Wi-Fi TX can dip the 5V rail. Keep the volume cap, and if resets appear during playback, lower the volume first.

## 4. What works, what doesn't (as of 14 Nov, 21:00 MYT)

| Part | Status |
|---|---|
| ESP32 boot, PSRAM 8192 KB | ✅ |
| Display ST7789 | ✅ wired. The test sketch `petto_test.ino` draws the Petto UI |
| MPU6050 | ✅ on I2C |
| Mic INMP441 | ✅ wired. The hold-to-record test worked earlier on the breadboard |
| Buttons | ✅ all three: A 18, B 8, C 13 |
| Speaker / amp | ✅ working (8 Ω 0.5 W). Keep the volume cap. Still show `reply` text on screen too, so the demo reads well in a noisy room |
| Wi-Fi | not yet tested on the perfboard (antenna end of the module sits over bare perfboard, fine) |

Test sketches from the hardware chat (put them under `firmware/tests/`):
- `petto_test/petto_test.ino`: full self-test. Pet page + test page on the display, live serial log, keys `h s t b r p q`.
- `speaker_only_test/speaker_only_test.ino`: amp/speaker isolation, beep every 2 s, `s` swaps BCLK/LRC.

## 5. Display: what the demo screen must look like

**Style** (from the Petto logo the team made): chunky **pixel art**, off-white background, dark green ink, mint egg, little green sprouts.

| Token | RGB | Use |
|---|---|---|
| BG | (246, 250, 243) | background |
| INK | (26, 52, 36) | title, outlines, text |
| EGG | (196, 240, 204) | egg fill |
| EGG_HI | (232, 252, 236) | egg highlight |
| SPOT | (88, 196, 120) | egg spots, OK tags, meters |
| LEAF | (120, 214, 96) | sprout leaves |
| BODY | (98, 204, 120) | sprout body |
| RED | (220, 70, 60) | recording / errors |

- Title "Petto": Adafruit GFX built-in font at size 6 (looks pixel), INK, with a small SPOT square on the second "t".
- The repo's `art/nearling_sprites.h` (32×32 RGB565 sprites, palettes, clips) is the pet itself. Scale ×4 or ×5 (128–160 px) in the middle of the screen. The `petto_test.ino` egg/sprout drawings can be used for the **pairing / egg** screens.
- **Use a full-frame `GFXcanvas16(240,240)` in PSRAM** and push it with `drawRGBBitmap` at about 20–25 fps: no flicker. That's proven in `petto_test.ino`.
- **Bottom hint bar** on every screen, size-1 text, e.g. `A back · B menu (hold: talk) · C pat`.
- Rotation: `setRotation(0)` in the test sketch. If the picture is upside down in the shell, use 2.
- **The physical window shows the full 240×240** (frame insert aperture ≈ 24 mm square, the panel's active area). Keep important text **≥6 px from the edges**.

**Screens needed for the demo** (in priority order):
1. **Boot**: Petto logo + "connecting Wi-Fi…".
2. **Pairing**: QR of `qr_url` (use a QR library, e.g. `ricmoo/QRCode`, scale to ~180 px, black on white with a quiet zone) + "Scan to hatch" + countdown. Then **"Pair <pet_name>? B = yes, A = no"**.
3. **Pet**: sprite clip by `display_state`, name, fuel bar (`fuel` from `/state`), hint bar.
4. **Listening**: red "listening…" pill + mic level bar while B is held.
5. **Thinking**: dots animation while `/talk` runs (can take 3–10 s).
6. **Reply**: scrolling `reply` text in a speech bubble + emotion clip, and "✓ model verified" if the response says so.
7. **Low fuel**: from `status: "canned"` + `fuel.left: 0`, showing "Feed me!" + a QR to `/feed` (optional).
8. Menu / stats / closet / approve: only if time allows (A back, B select, C next).

## 6. Audio

**Mic (record):** `I2SClass mic; mic.setPins(5, 6, -1, 7); mic.begin(I2S_MODE_STD, 16000, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT);`
- Read int32 samples and convert with `s >> 14`, plus a DC-removal high-pass and a clamp to int16. That gives a good level for Whisper.
- Buffer in **PSRAM** (`ps_malloc`): 12 s × 16000 × 2 B = 384 KB max (protocol limit 12 s).
- Upload as **WAV, 16 kHz, mono, 16-bit PCM** (44-byte RIFF header + data). Ignore holds under 0.5 s.

**Amp (play):** `I2SClass spk; spk.setPins(15, 16, 17); spk.begin(I2S_MODE_STD, 16000, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);` (use the stereo slot mode if mono gives silence).
- Mic and amp are **two separate I2S peripherals**, so both can be started at boot.
- `/talk` returns `audio_url` (relative to the brain, **WAV or MP3**).
  - Easiest: make the brain produce **16 kHz 16-bit mono WAV / PCM** (ElevenLabs `output_format=pcm_16000`) so the ESP32 streams it straight to I2S with no decoder.
  - If it's MP3, use `ESP8266Audio` (`AudioGeneratorMP3` + `AudioOutputI2S` on pins 15/16/17), but it costs flash and time, so prefer WAV.
- Apply `AMP_VOLUME_MAX` as a sample multiplier. 8 Ω 0.5 W speaker: stay at or under ~0.6 of full scale at +6 dB gain.

## 7. Motion (care without the touch sensor)

MPU6050 raw registers (no library needed): wake with `0x6B = 0`, ±2 g (`0x1C = 0`), ±250 dps (`0x1B = 0`), read 14 bytes from `0x3B`.
- **shake**: low-pass of `| |a| − 1 g |`, scaled by 10. A value above about **1.2** = shaking → `care: shake` (dizzy).
- **rock**: slow back-and-forth tilt (`ax` sign changes 2–3 times within 3 s, small amplitude) → `care: rock` (sleepy).
- **pat**: moved from the touch pad to a **C short press** on the Pet screen.
- **sleep**: menu item, or no motion and no button for N minutes.
- Send care through `POST /pets/:ref/care` per DEVICE_PROTOCOL §6, queued and retried; never block the UI.

## 8. Networking / brain

- Brain: `https://nearling-brain.fly.dev` (**confirm it's deployed**; DEPLOY.md uses this name). Battle socket: `wss://<brain>/battle/ws?code=` (not `race/ws`). Web: `https://<app>.vercel.app` (ask the team for the real URL).
- TLS: use the Arduino/IDF **CA bundle** (`WiFiClientSecure` + `setCACertBundle`), or for the demo only `setInsecure()` with a comment and a TODO.
- Device identity: `hw_id` = the chip MAC as hex. `device_secret` = 32 random chars generated on first boot and stored in **NVS** (`Preferences`). Pairing calls send `X-Device-Id` / `X-Device-Secret`; after pairing, every call sends `Authorization: Device <token>`.
- Store in NVS: Wi-Fi SSID/pass, `device_secret`, `device_token`, `pet_ref`.
- **Wi-Fi setup for the demo:** hard-code SSID/pass in `secrets.h` (gitignored), with a serial command `w ssid,pass` to change it. A captive portal is not needed for the hackathon.
- Poll cadence per protocol: pairing every 2 s, `/state` every 20 s (3 s during an approval). Do HTTP on a **FreeRTOS task** so animations and buttons never freeze. Show "thinking…" during `/talk`.

## 9. Physical / assembly constraints the firmware should respect

- Enclosure: front shell + **spacer band (3, 4 or 5 cm)** + back shell. The band holds the **rocker switch** (left side) and the **TP4056 USB-C** (bottom).
- The ESP32's upload USB-C is **inside** the case. To reflash after assembly, the case must be opened, so get OTA in early if possible (`ArduinoOTA`, or an HTTP OTA path), or flash everything before closing it.
- Buttons: the red caps stick out about 3 mm. Presses are solid; use 25 ms debounce. Hold-to-talk = hold **B**.
- Mic hole is on the side of the front shell. Speak toward the front/side from 10–30 cm.
- Speaker faces the back grille. Sound is quieter from the front; demo with the device facing the audience slightly turned.

## 10. Build order for tonight (stop after any step and you still have a demo)

1. `board_config.h` → the pins above. `petto_test.ino` behaviour ported into PlatformIO (or keep Arduino IDE). Display + buttons + mic + MPU verified.
2. Wi-Fi + `POST /devices/hello` + NVS identity. Serial log every request/response code.
3. Pairing: QR screen → poll → "Pair <name>? B = yes" → `/devices/pairing/confirm` → store the token. **Test with the real web `/hatch` flow.**
4. Pet screen from `/state` with the repo sprites.
5. **Hold B to talk** → WAV upload → show `reply` text and play `audio_url`.
6. Care: C = pat on the Pet screen, shake / rock from the MPU.
7. Menu with A/B/C (feed, closet, sleep), then the B-hold approval, then the Pet Battle (section 12). Only if time remains.

## 11. Known gotchas

- PSRAM reads 0 KB → the PSRAM setting isn't OPI.
- "MPU MISSING" → loose module joint, or SDA/SCL swapped (1 = SDA, 2 = SCL).
- Screen black → SPI mode (3 ↔ 0), BLK not HIGH, or RES not toggled. Shifted image → rotation / offsets (Adafruit's `init(240,240)` handles the 240×240 offsets).
- Upload fails while the Serial Monitor is open → close it (only one program can hold COM9).
- Button reads stuck LOW → a solder bridge to GND on that pin.
- Speaker silent → check amp VIN ≈ 5 V, SD not grounded, and continuity on 15/16/17. `speaker_only_test.ino` isolates it.

## 12. Game: Pet Battle (replaced the race). Study it in the codebase

The two-lane race is gone. The game is now a **turn-based pet battle**, built and live on the web at `/battle`. The brain referees every turn, so the device only has to **show the state and send the chosen move**. Before writing any battle code on the device, read these yourself:

| What | Where |
|---|---|
| Hardware notes for battles (start here) | `docs/hardware/BATTLE.md`, and `docs/hardware/DEVICE_PROTOCOL.md` §10 |
| Design + plan | `docs/superpowers/specs/2026-11-14-pet-battle-design.md`, `docs/superpowers/plans/2026-11-14-pet-battle.md` |
| Rules (stats, skills, turn resolution, integer maths, mulberry32 RNG) | `packages/battle/src/index.ts`, golden vectors `packages/battle/vectors/turns.json` |
| Socket protocol | `packages/battle/src/protocol.ts`; summary in `AI-brain architectual/08-api-reference.md` (section Battle) |
| Brain side (rooms, referee, results, XP) | `brain/src/battle/hub.ts`, `routes.ts`, `record.ts`, migration `900_battle.sql` |
| On-chain record | `contract/src/battle.rs`, `docs/CONTRACT_INTERFACE.md` |
| Reference UI to copy on the 240×240 screen | `web/components/battle/BattleScreen.tsx`, `StatusPlate.tsx`, `BattleMenu.tsx`, `RoomQr.tsx`, `web/app/battle/` |

Key points already known (verify against the code, it changes fast):
- The battle socket is `GET /battle/ws?code=`. Its routes accept a **web session** today. Letting the device join needs the brain to also accept `Authorization: Device <token>` (`BATTLE.md` calls this a small brain change). Check whether it has landed before building the device side.
- The device does **not** need to resolve turns. It renders the brain's `events` and `state`. Porting the rules to C++ is only for showing which skills are usable and their MP cost; if you port them, test against `turns.json`.
- Screen: two status plates (name, level, HP and MP bars), the two pets (repo sprites), a message box, and the menu **Fight / Run → Attack, 3 family skills (locked ones show "Lv N"), Back**.
- Buttons: **A = up, C = down, B = select** (A also works as Back where there's no list).
- Demo priority: battle on the device is a **stretch**. The demo can show the battle in the browser with the device's pet. Do steps 1–6 of section 10 first.
