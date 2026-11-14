// Petto device: board configuration as built (firmware/HARDWARE_HANDOFF.md section 2).
// ESP32-S3-WROOM-1 N16R8. Never use: 35-37 (PSRAM), 0, 3, 45, 46 (strapping), 19, 20 (USB),
// 38-40 (SD slot), 48 (on-board RGB LED).
#pragma once

// Display ST7789 240x240 "GMT130", SPI, no CS
#define PIN_TFT_SCLK 12
#define PIN_TFT_MOSI 11
#define PIN_TFT_RST  10
#define PIN_TFT_DC    9
#define PIN_TFT_BLK  14
#define TFT_SPI_MODE SPI_MODE3   // if the screen stays black, try SPI_MODE0
#define TFT_ROTATION 0           // 2 if the picture is upside down in the shell
#define TFT_W 240
#define TFT_H 240

// Mic INMP441 (L/R to GND = left slot)
#define PIN_MIC_SCK 5
#define PIN_MIC_WS  6
#define PIN_MIC_SD  7
#define MIC_SAMPLE_HZ 16000
#define REC_MAX_SECONDS 12       // protocol limit
#define REC_MIN_MS 500           // shorter holds are ignored

// Amp MAX98357A (VIN 5 V, GAIN to VIN = +6 dB), 8 ohm 0.5 W speaker
#define PIN_AMP_BCLK 15
#define PIN_AMP_LRC  16
#define PIN_AMP_DIN  17
#define AMP_VOLUME_MAX 0.6f      // about 0.4 W into 8 ohm at +6 dB. Do NOT move GAIN to GND with this speaker

// I2C: MPU6050
#define PIN_I2C_SDA 1
#define PIN_I2C_SCL 2

// Buttons to GND, INPUT_PULLUP, active LOW
#define PIN_BTN_A 18   // left: back / up
#define PIN_BTN_B  8   // middle: select, hold to talk
#define PIN_BTN_C 13   // right: pat / down
#define BTN_DEBOUNCE_MS 25
#define BTN_HOLD_MS    400
#define APPROVE_HOLD_MS 2000

// Motion thresholds (handoff section 7)
#define SHAKE_THRESHOLD 1.2f
