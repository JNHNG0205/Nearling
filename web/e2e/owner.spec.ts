import { expect, test, type Page } from "@playwright/test";
import { BRAIN_URL, brainSession, e2eAccount, type BrainSession } from "./helpers";

// Owner flows. A wallet popup cannot be driven headless, so the test signs the brain's NEP-413
// sign-in message with a throwaway full-access key of a real testnet account (what the wallet
// does) and puts the resulting brain session into localStorage, as web/lib/wallet.ts would.

const acct = e2eAccount();
const NO_ACCOUNT =
  "No e2e testnet account: create brain/data/testnet-accounts.env with E2E_PLAYER_ID, E2E_PLAYER_KEY " +
  "(full-access key of a funded testnet account) and E2E_PLAYER_PET (a pet ref it owns with fuel left)";

test.describe("owner", () => {
  test.skip(!acct || !acct.pet, NO_ACCOUNT);

  let session: BrainSession;
  test.beforeAll(async () => {
    session = await brainSession(acct!);
  });

  const open = async (page: Page, path: string) => {
    await page.goto("/");
    await page.evaluate((s) => localStorage.setItem("nearling.session", JSON.stringify(s)), session);
    await page.goto(path);
  };
  // The staging NEAR AI key in .env is rejected (401 invalid_api_key, 2026-11-11), so no real
  // reply or transcription can happen. Set E2E_NEARAI_OK=1 once a valid key is in .env.
  const NEARAI = process.env.E2E_NEARAI_OK === "1";
  const NEARAI_SKIP = "NEAR AI staging key invalid (401), rerun when a valid key is in .env (E2E_NEARAI_OK=1)";

  const petPath = () => `/pet/${encodeURIComponent(acct!.pet!)}`;

  test("talk with text gets a real reply and a resolved receipt", async ({ page }) => {
    test.skip(!NEARAI, NEARAI_SKIP);
    test.setTimeout(120_000);
    await open(page, petPath());
    const input = page.getByPlaceholder(/^Type to /);
    await expect(input).toBeVisible();
    await input.fill("Hi! What is your favourite colour?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    // a receipt chip appears under the reply, then leaves "verifying" within 60 s
    const chip = page.getByRole("link", { name: /See the receipt/ }).last();
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await expect(chip).not.toHaveAccessibleName(/^Verifying/i, { timeout: 60_000 });
  });

  test("talk while NEAR AI is failing shows the pet's resting reply or an error", async ({ page }) => {
    test.skip(NEARAI, "NEAR AI works; the real-reply test covers talk");
    await open(page, petPath());
    await page.getByPlaceholder(/^Type to /).fill("Hello?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    // an in-character canned line in the chat log, or the friendly error copy; never a blank or a crash
    await expect(page.getByRole("alert").or(page.locator("main li").last()).first()).toBeVisible({ timeout: 60_000 });
  });

  test("hold to talk records from the fake microphone", async ({ page, context }) => {
    test.skip(!NEARAI, NEARAI_SKIP);
    test.setTimeout(120_000);
    await context.grantPermissions(["microphone"]);
    await open(page, petPath());
    const hold = page.getByRole("button", { name: "Hold to talk" });
    await expect(hold).toBeVisible();
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByRole("button", { name: /Listening/ })).toBeVisible();
    await page.waitForTimeout(2_500);
    await page.mouse.up();
    // the fake device plays a beep: the brain either transcribes it into a turn or says it heard nothing
    await expect(
      page.getByRole("link", { name: /See the receipt/ }).or(page.getByText(/didn.t catch|heard nothing|try again/i)).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("inbox opens", async ({ page }) => {
    await open(page, petPath());
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(page.getByRole("region", { name: "Inbox" })).toBeVisible();
  });

  test("closet asks for the owner wallet without NEAR Connect", async ({ page }) => {
    // The closet uses OwnerGate, which needs a NEAR Connect wallet account as well as the brain
    // session, so headless it can only show the connect prompt (LIMITATIONS W1).
    await open(page, `${petPath()}/closet`);
    await expect(page.getByText(/owner wallet to continue/)).toBeVisible();
  });

  test("session is accepted by owner routes", async () => {
    const r = await fetch(`${BRAIN_URL}/pets/${encodeURIComponent(acct!.pet!)}/inbox`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(r.status).toBe(200);
  });
});
