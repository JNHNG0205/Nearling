# Pin tables

Module pin on the left, ESP32-S3 pin on the right. 3V3 and GND go through the breadboard's red and blue lines; SDA and SCL through one shared column each. Source of truth: `firmware/include/board_config.h`.

## OLED display (1.3 in, I2C)
| OLED | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SCK | GPIO 2 |
| SDA | GPIO 1 |

## Light sensor (GY-30 / BH1750)
| Light sensor | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SCL | GPIO 2 |
| SDA | GPIO 1 |
| ADD | not connected |

## Motion sensor (GY-521 / MPU6050)
| Motion sensor | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SCL | GPIO 2 |
| SDA | GPIO 1 |
| XDA, XCL, AD0, INT | not connected |

## Touch pad (TTP223)
| Touch pad | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| I/O | GPIO 8 |

## Buttons
| Button | Tab 1 | Tab 2 |
|---|---|---|
| A | GPIO 41 | GND |
| B | GPIO 42 | GND |
| C | GPIO 47 | GND |

## Microphone (INMP441)
| Mic | ESP32 |
|---|---|
| VDD | 3V3 |
| GND | GND |
| L/R | GND |
| SCK | GPIO 4 |
| WS | GPIO 5 |
| SD | GPIO 6 |

## Amplifier (MAX98357)
| Amp | ESP32 |
|---|---|
| VIN | 3V3 |
| GND | GND |
| GAIN | 3V3 |
| BCLK | GPIO 15 |
| LRC | GPIO 16 |
| DIN | GPIO 7 |
| SD | not connected |
| + / - | Speaker wires |
