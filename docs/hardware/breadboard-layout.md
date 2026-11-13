# Bench layout (MB-102)

The ESP32 sits **off** the breadboard. Each ESP32 pin connects with a **female-to-male** jumper: socket on the ESP32 pin, pin end in the breadboard. The modules sit on the breadboard. Pins come from `firmware/include/board_config.h`.

Use the bottom red (+) and blue (-) lines. They are split near column 30: bridge each with a short jumper.

## Bus columns (shared wires)

Several modules share these, so give each its own breadboard column and run every module to it:

| Column | Joined to |
|---|---|
| Red line | ESP32 `3V3` |
| Blue line | ESP32 `GND` |
| SDA column (e.g. column 2, rows A to E) | ESP32 `1` |
| SCL column (e.g. column 4, rows A to E) | ESP32 `2` |

## Wires

| Module | Wires |
|---|---|
| OLED display | VCC -> red, GND -> blue, SDA -> SDA column, SCK -> SCL column |
| Motion (GY-521) | VCC -> red, GND -> blue, SDA -> SDA column, SCL -> SCL column |
| Light (GY-30) | VCC -> red, GND -> blue, SDA -> SDA column, SCL -> SCL column, ADDR open |
| Touch (TTP223) | VCC -> red, GND -> blue, I/O -> ESP32 `8` |
| Buttons A / B / C | One leg -> ESP32 `41` / `42` / `47`, diagonally opposite leg -> blue |
| Mic (INMP441) | VDD -> red, GND -> blue, SCK -> `4`, WS -> `5`, SD -> `6`, L/R -> blue |
| Amp (MAX98357) | VIN -> red, GND -> blue, BCLK -> `15`, LRC -> `16`, DIN -> `7`, GAIN -> VIN, SD open; speaker on + and - |

Unplug USB before adding or moving any wire.
