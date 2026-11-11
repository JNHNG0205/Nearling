import { expect, test } from "@playwright/test";
import { BRAIN_URL, DEMO_PET, DEMO_PET_PATH, distinctFrames, inkedPixels } from "./helpers";

// Pages anyone can open, against the live brain and testnet. No route mocks anywhere.

test("landing draws the live demo pet and shows no sample data", async ({ page }) => {
  const live = (await (await fetch(`${BRAIN_URL}/pets/${DEMO_PET_PATH}/state`)).json()) as { name: string };
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Nearling");

  // the hero egg hatches, then the live demo pet (DEMO_PET_REF) shows with its fuel meter
  const hero = page.getByRole("img", { name: new RegExp(`^${live.name}, `) });
  await expect(hero).toBeVisible({ timeout: 20_000 });
  expect(await inkedPixels(hero)).toBeGreaterThan(50);
  await expect(page.getByRole("meter", { name: /Fuel: \d+ thoughts? left/ }).first()).toBeVisible();

  // rule 5: nothing fabricated on the landing page
  await expect(page.getByText(/\bsample\b/i)).toHaveCount(0);
});

test("pet home shows live state, fuel and care animates the canvas", async ({ page }) => {
  const live = (await (await fetch(`${BRAIN_URL}/pets/${DEMO_PET_PATH}/state`)).json()) as {
    name: string;
    fuel: { left: number };
    demo_speed: boolean;
  };
  await page.goto(`/pet/${DEMO_PET_PATH}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(live.name);
  await expect(page.getByRole("meter", { name: `Fuel: ${live.fuel.left} ${live.fuel.left === 1 ? "thought" : "thoughts"} left` })).toBeVisible();
  if (live.demo_speed) await expect(page.getByText(/demo speed/i).first()).toBeVisible();
  // a visitor gets the Connect / Feed panel, not the talk bar
  await expect(page.getByText("Connect your wallet to talk.")).toBeVisible();

  const canvas = page.getByRole("img", { name: live.name, exact: true });
  await expect(canvas).toBeVisible();
  expect(await inkedPixels(canvas)).toBeGreaterThan(50);

  for (const label of ["Pat", "Rock", "Shake", "Lights off"]) {
    await page.getByRole("group", { name: "Care" }).getByRole("button", { name: label, exact: true }).click();
    const frames = await distinctFrames(page, canvas, 1_500);
    expect(frames, `${label} should animate`).toBeGreaterThan(1);
  }
});

test("public page renders and its OG image is a PNG", async ({ page, request }) => {
  const live = (await (await fetch(`${BRAIN_URL}/pets/${DEMO_PET_PATH}/state`)).json()) as { name: string };
  await page.goto(`/p/${DEMO_PET_PATH}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(live.name);

  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toBeTruthy();
  const res = await request.get(new URL(og!).pathname + new URL(og!).search);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
  const body = await res.body();
  expect(body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(body.length).toBeGreaterThan(2_000);
});

test("sprite gallery draws every clip", async ({ page }) => {
  await page.goto("/dev/sprites");
  const canvases = page.locator("main li canvas");
  await expect(canvases.first()).toBeVisible();
  const n = await canvases.count();
  expect(n).toBeGreaterThan(10);
  await page.waitForTimeout(500);
  for (let i = 0; i < n; i += 1) {
    const c = canvases.nth(i);
    const label = await c.getAttribute("aria-label");
    expect(await inkedPixels(c), `clip ${label} is empty`).toBeGreaterThan(20);
  }
  // the egg stage has its own clip set
  await page.getByLabel("Stage").selectOption("egg");
  await expect(page.locator("main li canvas").first()).toBeVisible();
  const eggs = page.locator("main li canvas");
  for (let i = 0; i < (await eggs.count()); i += 1) {
    expect(await inkedPixels(eggs.nth(i))).toBeGreaterThan(20);
  }
});

test("privacy page shows the brain's attestation", async ({ page }) => {
  const att = (await (await fetch(`${BRAIN_URL}/attestation`)).json()) as { models: { model: string }[] };
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Latest attestation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is checked" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is not checked" })).toBeVisible();
  // the page is cached for 5 min, so it may lag the brain by one refresh
  const section = page.locator("section[aria-labelledby=att]");
  if (att.models.length > 0) {
    await expect(section.getByText(/GPU attestation/).first()).toBeVisible();
  } else {
    await expect(section).toContainText(/No attestation fetched yet|GPU attestation/);
  }
  await expect(section).not.toContainText("did not answer");
});

test("pet state comes from the chain contract named in the ref", async () => {
  const s = (await (await fetch(`${BRAIN_URL}/pets/${DEMO_PET_PATH}/state`)).json()) as { pet_ref: string; owner: string };
  expect(s.pet_ref).toBe(DEMO_PET);
  expect(s.owner).toMatch(/\.testnet$/);
});
