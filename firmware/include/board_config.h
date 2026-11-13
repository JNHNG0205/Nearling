// Nearling board configuration: every hardware setting lives here (Build Spec, hardware reference).
// Board: QQ "ESP32-S3-CAM" (ESP32-S3-WROOM-1 N16R8, Freenove-style layout). Camera disconnected.
// [VERIFY] each pin against the received unit before wiring. See docs/hardware/wiring.md.
#pragma once

// Bench setup: the board sits off the breadboard and every pin is reached with a
// female-to-male jumper (socket on the ESP32 pin), so both pin rows are usable.

// ---- Reserved: never assign ----
// GPIO 35, 36, 37   octal PSRAM (N16R8)
// GPIO 19, 20       USB D-/D+ (USB-OTG port)
// GPIO 43, 44       UART0 TX/RX (USB-UART port, serial log)
// GPIO 0, 3, 45, 46 strapping pins
// GPIO 48           onboard RGB LED on most boards of this layout [VERIFY]
// GPIO 38, 39, 40   microSD slot (unused, left free)

// ---- Display: 1.3" OLED 128x64, I2C (VCC, GND, SCK, SDA), shares the sensor bus ----
// The part received is this OLED, not the ST7789 240x240 TFT on the shopping list.
// Driver SH1106 (usual for 1.3"); if the picture is shifted or garbled, try SSD1306.
#define DISPLAY_OLED_SH1106 1
#define OLED_WIDTH    128
#define OLED_HEIGHT    64
#define ADDR_OLED    0x3C

// ---- Microphone: INMP441, I2S port 0 (RX) ----
// L/R pin to GND = left channel.
#define PIN_MIC_SCK     4
#define PIN_MIC_WS      5
#define PIN_MIC_SD      6
#define MIC_SAMPLE_HZ  16000
#define MIC_MAX_SECONDS   10

// ---- Amplifier: MAX98357, I2S port 1 (TX) ----
// VIN from 3V3, GAIN tied to VIN (6 dB, lowest without a resistor).
#define PIN_AMP_BCLK   15
#define PIN_AMP_LRC    16
#define PIN_AMP_DIN     7
#define AMP_VOLUME_MAX  0.25f  // software cap; raise only after a bench test (speaker 0.4 W peak)

// ---- I2C: OLED (0x3C) + MPU6050 (0x68) + BH1750 (0x23) on one bus ----
#define PIN_I2C_SDA     1
#define PIN_I2C_SCL     2
#define I2C_HZ      400000
#define ADDR_MPU6050  0x68
#define ADDR_BH1750   0x23

// ---- Inputs ----
// Buttons wire GPIO to GND, INPUT_PULLUP, active low.
#define PIN_BTN_A      41   // left / back
#define PIN_BTN_B      42   // select, hold-to-talk, hold-to-approve, lane switch
#define PIN_BTN_C      47   // right / menu
#define PIN_TOUCH       8   // TTP223 OUT, active high (default jumpers)
#define BTN_DEBOUNCE_MS   25
#define BTN_HOLD_MS      600
#define APPROVE_HOLD_MS 2000
