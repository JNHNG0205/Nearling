import { expect, test } from "@playwright/test";
import { DEMO_PET_PATH } from "./helpers";

// Full-page screenshots of every route at phone and desktop width into e2e/screenshots/
// (gitignored) for a human or agent to look at. Fails only on a server error or a JS crash.

const PAGES: [string, string][] = [
  ["landing", "/"],
  ["adopt", "/adopt"],
  ["hatch", "/hatch"],
  ["pet", `/pet/${DEMO_PET_PATH}`],
  ["closet", `/pet/${DEMO_PET_PATH}/closet`],
  ["soul", `/pet/${DEMO_PET_PATH}/soul`],
  ["garden", `/pet/${DEMO_PET_PATH}/garden`],
  ["device", `/pet/${DEMO_PET_PATH}/device`],
  ["receipts", `/pet/${DEMO_PET_PATH}/receipts`],
  ["settings", `/pet/${DEMO_PET_PATH}/settings`],
  ["transfer", `/pet/${DEMO_PET_PATH}/transfer`],
  ["my", "/my"],
  ["feed", `/feed/${DEMO_PET_PATH}`],
  ["public", `/p/${DEMO_PET_PATH}`],
  ["privacy", "/privacy"],
  ["race", "/race"],
  ["wallet", "/wallet"],
  ["sprites", "/dev/sprites"],
  ["receipt-missing", "/receipt/does-not-exist"],
  ["order-missing", "/order/does-not-exist"],
  ["approve-missing", "/approve/does-not-exist"],
];

const VIEWPORTS = [
  { tag: "390", width: 390, height: 844 },
  { tag: "1440", width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  test.describe(`screens ${vp.tag}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const [name, path] of PAGES) {
      test(name, async ({ page }) => {
        const crashes: string[] = [];
        page.on("pageerror", (e) => crashes.push(e.message));
        const res = await page.goto(path);
        expect(res?.status() ?? 0, `${path} status`).toBeLessThan(500);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await page.waitForTimeout(3_000); // hatch animation, polls, fonts
        // no horizontal page scroll at any width
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        await page.screenshot({ path: `e2e/screenshots/${name}-${vp.tag}.png`, fullPage: true });
        expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
        expect(crashes, `${path} threw`).toEqual([]);
      });
    }
  });
}
