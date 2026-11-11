import { expect, test, type Page } from "@playwright/test";
import { TICKS_PER_SECOND, simulate } from "@nearling/race";
import { distinctFrames } from "./helpers";

// Nearling Run between two browser contexts over the brain's real WebSocket (LIMITATIONS W2).
// The host dodges with the keyboard, the guest does nothing, so the host must win: that proves
// key input reaches the RaceCanvas, the brain replays both runs and both pages get the result.

// the host must stay alive this long after the guest's crash, so the brain's result is a clear win
const MARGIN_TICKS = 2 * TICKS_PER_SECOND;

// Without the keydown probe below, about 1 run in 10 sent no lane switch at all (keys ignored for
// the whole race; cause not found). With the probe it passed 32 of 32. One retry covers the rest.
test.describe.configure({ retries: 1 });

/**
 * Lane-switch windows that keep a racer alive for `upTo` ticks on this seed: for each crash, the
 * widest run of switch ticks that avoids it (planned with a switch in the middle of each run).
 */
function plan(seed: number, upTo: number): { from: number; to: number }[] {
  const switches: number[] = [];
  const windows: { from: number; to: number }[] = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const crash = simulate(seed, switches, upTo);
    if (crash === null) return windows;
    const from = switches.length ? switches.at(-1)! + 1 : 0;
    const ok: number[] = [];
    for (let t = Math.max(from, crash - 60); t < crash; t += 1) {
      const c = simulate(seed, [...switches, t], upTo);
      if (c === null || c > crash) ok.push(t);
    }
    if (!ok.length) throw new Error(`no dodge for crash at tick ${crash}`);
    // widest run of consecutive good ticks
    let best: number[] = [];
    let run: number[] = [];
    for (const t of ok) {
      run = run.length && t === run.at(-1)! + 1 ? [...run, t] : [t];
      if (run.length > best.length) best = run;
    }
    switches.push(best[Math.floor(best.length / 2)]!);
    windows.push({ from: best[0]!, to: best.at(-1)! });
  }
  throw new Error("plan did not converge");
}

function watchStart(page: Page): Promise<{ seed: number; start_at: number }> {
  return new Promise((resolve) => {
    page.on("websocket", (ws) =>
      ws.on("framereceived", (f) => {
        try {
          const m = JSON.parse(String(f.payload)) as { type?: string; seed?: number; start_at?: number };
          if (m.type === "start" && typeof m.seed === "number" && typeof m.start_at === "number") {
            resolve({ seed: m.seed, start_at: m.start_at });
          }
        } catch {
          // not JSON
        }
      }),
    );
  });
}

test("two browsers race to a result", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  const started = watchStart(host);
  await host.addInitScript(() => {
    const w = window as unknown as { __keys: string[] };
    w.__keys = [];
    window.addEventListener("keydown", (e) => w.__keys.push(`${e.code}@${document.hasFocus() ? "f" : "nf"}`), true);
  });
  let laneMsgs = 0; // lane switches the host page actually sent to the brain
  host.on("websocket", (ws) => ws.on("framesent", (f) => void (String(f.payload).includes('"type":"lane"') && (laneMsgs += 1))));

  await host.goto("/race");
  await host.getByLabel("Your racer's name").fill("HostE2E");
  await host.getByRole("button", { name: "Start a race" }).click();
  await host.waitForURL(/\/race\/[A-Z0-9]{6}$/);
  const code = host.url().split("/").pop()!;
  await expect(host.getByText("connected", { exact: true })).toBeVisible();

  await guest.goto("/race");
  await guest.getByLabel("Your racer's name").fill("GuestE2E");
  await guest.getByPlaceholder("ABC234").fill(code);
  await guest.getByRole("button", { name: "Join a race" }).click();
  await guest.waitForURL(new RegExp(`/race/${code}$`));
  await expect(guest.getByText("connected", { exact: true })).toBeVisible();

  for (const p of [host, guest]) {
    await expect(p.getByText("HostE2E")).toBeVisible();
    await expect(p.getByText("GuestE2E")).toBeVisible();
  }

  await host.getByRole("button", { name: "Get ready to race" }).click();
  await expect(host.getByRole("button", { name: "Waiting for the other racer" })).toBeVisible();
  await guest.getByRole("button", { name: "Get ready to race" }).click();

  const { seed, start_at } = await started;
  // the guest (no input) crashes at this tick; the host must outlast it
  const guestCrash = simulate(seed, []);
  expect(guestCrash).not.toBeNull();
  const switches = plan(seed, guestCrash! + MARGIN_TICKS);

  const track = (p: Page) => p.getByRole("img", { name: /Nearling Run track/ });
  await expect(track(host)).toBeVisible({ timeout: 20_000 });
  await expect(track(guest)).toBeVisible({ timeout: 20_000 });
  // countdown is drawn on the canvas, so frames change before the start
  expect(await distinctFrames(host, track(host), 1_000, 6)).toBeGreaterThan(1);

  // play the plan with absolute lane keys (ArrowLeft = lane 0, ArrowRight = lane 1); same machine as the brain
  // the guest was clicked last; give the host window focus back so its key events land
  await host.bringToFront();
  await host.evaluate(() => window.focus());
  // Two headless pages share one browser: focus moves back to the host a little after
  // bringToFront. Keys pressed before that never reach the page (seen as a lost first
  // ArrowRight window and a draw), so wait for real focus before the first key.
  await host.waitForFunction(() => document.hasFocus(), undefined, { timeout: 5_000 });
  let lane = 0;
  const tickAt = (t: number) => start_at + (t * 1000) / TICKS_PER_SECOND;
  for (const w of switches) {
    lane = lane === 0 ? 1 : 0;
    const key = lane === 1 ? "ArrowRight" : "ArrowLeft";
    // the keys name an absolute lane, so repeats inside the window are no-ops after the first lands
    for (let t = w.from; t <= w.to; t += 1) {
      const wait = tickAt(t) + 5 - Date.now();
      if (wait > 0) await host.waitForTimeout(wait);
      if (Date.now() < tickAt(w.to + 1)) await host.keyboard.press(key);
    }
  }

  const keys = await host.evaluate(() => (window as unknown as { __keys?: string[] }).__keys ?? []);
  expect(laneMsgs, `keyboard lane switches reached the brain (page saw ${keys.length} keydowns: ${keys.slice(0, 5).join(" ")})`).toBeGreaterThan(0);
  await expect(host.getByRole("heading", { level: 2, name: "You won" })).toBeVisible({ timeout: 60_000 });
  await expect(guest.getByRole("heading", { level: 2, name: "You lost" })).toBeVisible({ timeout: 30_000 });
  await host.screenshot({ path: "e2e/screenshots/race-result-host.png" });
  await guest.screenshot({ path: "e2e/screenshots/race-result-guest.png" });
});
