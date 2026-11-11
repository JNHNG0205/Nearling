import { expect, test } from "@playwright/test";

// /start without a wallet: steps 1 to 3 render, the browser skip moves on to the wallet step.

test("start wizard renders steps 1 to 3 and skips to the wallet without a device", async ({ page }) => {
  await page.goto("/start");
  await page.evaluate(() => window.localStorage.removeItem("nearling.start"));
  await page.reload();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up your Nearling");
  for (const title of ["Connect your Nearling", "Connect your wallet", "Choose your pet"]) {
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }
  await expect(page.getByText("Step 1 of 5")).toBeVisible();
  await expect(page.getByText("Scan the QR on your Nearling")).toBeVisible();
  // Bluetooth button where the browser has Web Bluetooth (headless Linux Chromium does not), else the QR-only note
  const hasBle = await page.evaluate(() => "bluetooth" in navigator);
  if (hasBle) await expect(page.getByRole("button", { name: "Find my Nearling" })).toBeVisible();
  else await expect(page.getByText(/On iPhone and Safari, use the QR code/)).toBeVisible();

  await page.getByRole("button", { name: "Continue in the browser" }).click();
  await expect(page.getByText("Step 2 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect Meteor|Loading wallet/ })).toBeVisible();

  // progress survives a reload
  await page.reload();
  await expect(page.getByText("Step 2 of 5")).toBeVisible();
});
