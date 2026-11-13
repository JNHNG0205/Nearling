# Nearling wiring (bench prototype)

Pin source of truth: `firmware/include/board_config.h`. Parts: the Nearling shopping list (RM209.60, QQ Online Trading).

**[VERIFY] before wiring:** pins assume the common Freenove-style ESP32-S3-CAM layout. Check every GPIO label on the received board. On our first unit the headers were soldered pointing out of the module side, so on a breadboard the labels face down and left and right are mirrored. Wire from this table, not from the silkscreen.

## Signals

| Module | Module pin | ESP32-S3 | Notes |
|---|---|---|---|
| 1.3" OLED (I2C, 4 pins) | VCC / GND | 3V3 / GND | Received instead of the ST7789 TFT. 0x3C |
| | SCK / SDA | 2 / 1 | Shared I2C bus |
| INMP441 mic | VDD / GND | 3V3 / GND | 3.3 V only |
| | SCK | 4 | I2S0 |
| | WS | 5 | |
| | SD | 6 | |
| | L/R | GND | Left channel |
| MAX98357 amp | VIN / GND | 3V3 / GND | 3V3 keeps output modest for the 0.4 W speaker |
| | BCLK | 15 | I2S1 |
| | LRC | 16 | |
| | DIN | 7 | |
| | GAIN | VIN | 6 dB |
| | SD | open | Default stereo-mix mono |
| | + / - | Speaker | |
| GY-521 MPU6050 | VCC / GND | 3V3 / GND | 0x68 |
| | SDA / SCL | 1 / 2 | Shared bus |
| GY-30 BH1750 | VCC / GND | 3V3 / GND | 0x23 (ADDR low or open) |
| | SDA / SCL | 1 / 2 | Shared bus |
| TTP223 touch | VCC / GND | 3V3 / GND | |
| | I/O | 8 | High on touch |
| Button A / B / C | one leg | 41 / 42 / 47 | Other leg to GND, internal pull-up |

Do not use: 0, 19, 20, 35, 36, 37, 43, 44, 45, 48, and 38 to 40 (microSD).

**Bench setup:** the ESP32 sits off the breadboard. Female-to-male jumpers go from its pins (socket end) into the breadboard, so both pin rows are usable. See `breadboard-layout.md`.

## Power (battery build)

```
LiPo 800 mAh -> TP4056 B+/B-
TP4056 OUT+ -> rocker switch -> MT3608 VIN+
TP4056 OUT- ---------------------> MT3608 VIN-
MT3608 VOUT+ (set to 5.0 V) -> board 5V pin
MT3608 VOUT- -> board GND
```

1. **Set the MT3608 to 5.0 V with a multimeter before connecting it to the board.** These modules often ship set much higher.
2. **Turn the rocker off while the board's USB is plugged in** until you confirm the board blocks back-feeding between USB 5 V and the 5V pin.
3. **TP4056 charge current:** the usual module default (1.2 kOhm program resistor) is 1 A, above 1C for an 800 mAh cell. Configure about 0.4 to 0.5 A as the shopping list notes.
4. Bench test Wi-Fi, display and audio together on battery: these current peaks are where brownouts show up.

## Bring-up order

I2C scan (expect 0x3C, 0x23 and 0x68), display, buttons and touch, mic level, speaker at low volume, then the same on battery power.
