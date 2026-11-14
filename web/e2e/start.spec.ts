import { expect, test } from "@playwright/test";

// /start without a wallet: the three setup steps render and step 1 asks for a wallet (new users
// follow setup; signed-in owners with pets are sent home, lib/flow.ts).

test("start wizard renders its three steps and asks for a wallet first", async ({ page }) => {
  await page.goto("/start");
  await page.evaluate(() => window.localStorage.removeItem("nearling.start"));
  await page.reload();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up your Petto");
  for (const title of ["Connect your wallet", "Hatch and customise your pet", "Connect your Petto or play in the browser"]) {
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  // step 1's own button (the header has one too)
  await expect(page.getByRole("main").getByRole("button", { name: /Connect wallet|Loading wallet/ })).toBeVisible();
});

test("landing leads signed-out visitors to Get started, and /go back to the landing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  await page.goto("/go");
  await expect(page).toHaveURL(/\/$/);
});
