// OUTDATED: early OLED breadboard self-test. The device firmware is firmware/petto/petto.ino (see firmware/HARDWARE_HANDOFF.md).
// Nearling bench bring-up test. Shows every input live on the display and on serial.
// Button B plays a short beep. Modules that are not wired yet show as "--".
// Replace this file with the real firmware once the bench checks pass.
#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <driver/i2s.h>
#include "board_config.h"

static U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
static bool hasMpu = false, hasBh = false, hasOled = false;

static bool i2cPresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

static void i2cWrite(uint8_t addr, const uint8_t *data, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(data, n);
  Wire.endTransmission();
}

static void micBegin() {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = MIC_SAMPLE_HZ;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.dma_buf_count = 4;
  cfg.dma_buf_len = 256;
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
  pins.bck_io_num = PIN_MIC_SCK;
  pins.ws_io_num = PIN_MIC_WS;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = PIN_MIC_SD;
  i2s_driver_install(I2S_NUM_0, &cfg, 0, nullptr);
  i2s_set_pin(I2S_NUM_0, &pins);
}

static void ampBegin() {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = MIC_SAMPLE_HZ;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.dma_buf_count = 4;
  cfg.dma_buf_len = 256;
  cfg.tx_desc_auto_clear = true;
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
  pins.bck_io_num = PIN_AMP_BCLK;
  pins.ws_io_num = PIN_AMP_LRC;
  pins.data_out_num = PIN_AMP_DIN;
  pins.data_in_num = I2S_PIN_NO_CHANGE;
  i2s_driver_install(I2S_NUM_1, &cfg, 0, nullptr);
  i2s_set_pin(I2S_NUM_1, &pins);
}

// Peak level of the latest mic block, 0 to about 32767.
static int32_t micPeak() {
  static int32_t buf[256];
  size_t got = 0;
  i2s_read(I2S_NUM_0, buf, sizeof(buf), &got, pdMS_TO_TICKS(20));
  int32_t peak = 0;
  for (size_t i = 0; i < got / 4; i++) {
    int32_t s = abs(buf[i] >> 14);
    if (s > peak) peak = s;
  }
  return peak;
}

// Blocking 440 Hz beep, fine for a bench test only.
static void beep(int ms) {
  static int16_t buf[256 * 2];
  const float amp = 32767.0f * AMP_VOLUME_MAX;
  uint32_t total = (uint32_t)MIC_SAMPLE_HZ * ms / 1000, n = 0;
  while (n < total) {
    for (int i = 0; i < 256; i++, n++) {
      int16_t s = (int16_t)(amp * sinf(2.0f * PI * 440.0f * n / MIC_SAMPLE_HZ));
      buf[2 * i] = s;
      buf[2 * i + 1] = s;
    }
    size_t wrote = 0;
    i2s_write(I2S_NUM_1, buf, sizeof(buf), &wrote, portMAX_DELAY);
  }
  i2s_zero_dma_buffer(I2S_NUM_1);
}

static float readLux() {
  if (Wire.requestFrom((int)ADDR_BH1750, 2) != 2) return -1;
  uint16_t raw = (Wire.read() << 8) | Wire.read();
  return raw / 1.2f;
}

// Acceleration magnitude in g (about 1.0 at rest).
static float readAccelG() {
  const uint8_t reg = 0x3B;
  Wire.beginTransmission(ADDR_MPU6050);
  Wire.write(reg);
  Wire.endTransmission(false);
  if (Wire.requestFrom((int)ADDR_MPU6050, 6) != 6) return -1;
  float sum = 0;
  for (int i = 0; i < 3; i++) {
    int16_t v = (Wire.read() << 8) | Wire.read();
    float g = v / 16384.0f;
    sum += g * g;
  }
  return sqrtf(sum);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN_A, INPUT_PULLUP);
  pinMode(PIN_BTN_B, INPUT_PULLUP);
  pinMode(PIN_BTN_C, INPUT_PULLUP);
  pinMode(PIN_TOUCH, INPUT);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_HZ);
  hasMpu = i2cPresent(ADDR_MPU6050);
  hasBh = i2cPresent(ADDR_BH1750);
  hasOled = i2cPresent(ADDR_OLED);
  if (hasOled) {
    oled.begin();
    oled.setFont(u8g2_font_6x10_tf);
  }
  if (hasMpu) {
    const uint8_t wake[] = {0x6B, 0x00};
    i2cWrite(ADDR_MPU6050, wake, 2);
  }
  if (hasBh) {
    const uint8_t mode[] = {0x10};  // continuous high resolution
    i2cWrite(ADDR_BH1750, mode, 1);
  }
  Serial.printf("I2C: OLED %s, MPU6050 %s, BH1750 %s\n", hasOled ? "found" : "missing", hasMpu ? "found" : "missing", hasBh ? "found" : "missing");

  micBegin();
  ampBegin();
}

void loop() {
  static uint32_t lastDraw = 0;
  static bool lastB = false;
  static int32_t peak = 0;

  int32_t p = micPeak();
  if (p > peak) peak = p;

  bool a = !digitalRead(PIN_BTN_A), b = !digitalRead(PIN_BTN_B), c = !digitalRead(PIN_BTN_C);
  bool touch = digitalRead(PIN_TOUCH);
  if (b && !lastB) beep(300);
  lastB = b;

  if (millis() - lastDraw < 200) return;
  lastDraw = millis();

  float lux = hasBh ? readLux() : -1;
  float g = hasMpu ? readAccelG() : -1;
  if (hasOled) {
    char line[24];
    oled.clearBuffer();
    oled.drawStr(0, 10, "Nearling bring-up");
    snprintf(line, sizeof(line), "Btn A%d B%d C%d T%d", a, b, c, touch);
    oled.drawStr(0, 22, line);
    if (lux < 0) snprintf(line, sizeof(line), "Light --");
    else snprintf(line, sizeof(line), "Light %.0f lx", lux);
    oled.drawStr(0, 34, line);
    if (g < 0) snprintf(line, sizeof(line), "Accel --");
    else snprintf(line, sizeof(line), "Accel %.2f g", g);
    oled.drawStr(0, 46, line);
    snprintf(line, sizeof(line), "Mic %ld  B=beep", (long)peak);
    oled.drawStr(0, 58, line);
    oled.sendBuffer();
  }
  Serial.printf("btn %d%d%d touch %d lux %.0f g %.2f mic %ld\n", a, b, c, touch, lux, g, (long)peak);
  peak = 0;
}
