import { defineConfig, devices } from "@playwright/test";

// Browser tests against a running web + brain on live testnet data, no mocks (LIMITATIONS W2, W12).
// Start both first:
//   brain on E2E_BRAIN_URL (default :8788), web on E2E_BASE_URL (default :3001) built with
//   NEXT_PUBLIC_BRAIN_URL pointing at that brain.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one brain, real chain reads: keep load and rate limits low
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    launchOptions: {
      // hold-to-talk records from Chromium's fake microphone (a beep), no permission prompt
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
