# Petto device sketch (Arduino IDE)

The device firmware for the board as built (`../HARDWARE_HANDOFF.md`). It follows `docs/hardware/DEVICE_PROTOCOL.md`: hello, pairing QR, pet screen from `/state`, hold-to-talk with a spoken reply, inbox, care (pat, shake, rock, sleep), feed QR.

## Upload

1. Copy `secrets.example.h` to `secrets.h` in this folder and fill in Wi-Fi and the brain URL (gitignored). You can leave it empty and set both over serial later.
2. Open `petto.ino` in Arduino IDE.
3. Tools: Board **ESP32S3 Dev Module**, PSRAM **OPI PSRAM**, Flash Size **16MB**, Partition Scheme **16M Flash (3MB APP/9.9MB FATFS)**, USB CDC On Boot **Disabled**, Port = the UART USB-C (COM9).
4. Libraries (Library Manager): Adafruit GFX, Adafruit ST7735 and ST7789, ArduinoJson 7. The QR code library is vendored here as `petto_qr.*`, because ESP32 core 3.x has its own `qrcode.h` that hides the library one.
5. Upload. Turn the rocker switch OFF while USB is plugged in. Close the Serial Monitor before uploading.

The first compile takes a few minutes (the sprite header is 1.6 MB).

## Serial Monitor (115200, newline)

| Command | Does |
|---|---|
| `w MySSID,MyPassword` | set Wi-Fi (saved in NVS) |
| `u https://<brain>` | set the brain URL (saved) |
| `i` | info: id, Wi-Fi, brain, pairing, sensors |
| `f` | forget the pairing token |
| `v 0.4` | volume (0 to 0.6, capped for the 0.5 W speaker) |
| `s` | sensor log on / off |
| `b` | beep |

## Buttons

| Screen | A (left) | B (middle) | C (right) |
|---|---|---|---|
| Pairing | no | yes (confirm "Pair <name>?") | |
| Pet | | short: menu, hold: talk | pat |
| Reply | close | | feed QR (when out of fuel) |
| Menu | up | select | down |

Shake = dizzy, gentle rocking = sleepy; both sync as care.

## Not in this build yet

Hold-to-approve wallet actions, the Closet picker, on-device signing and Pet Battle. TLS uses `setInsecure()` (TODO: CA bundle).

## Sprites and costumes

- `nearling_sprites.h` is a copy of `art/nearling_sprites.h`; copy it again after re-running the sprite export.
- `nearling_costumes.h` / `.cpp`: the 38 Closet costumes (back and front layers per frame, same pixels as the web), generated from `packages/sprites/src/costumes.ts`. The device draws the one in `/state` `equipped_costume`, instead of the plain shirt, like the web. Regenerate after any sprite or costume change (from the repo root, after `pnpm install`):

  ```
  packages/sprites/node_modules/.bin/tsx firmware/tools/export-costumes.ts
  ```

  At boot the serial log says `[ART] costumes ok`; if the table no longer matches the sprites it says so and costumes are not drawn.
