import { describe, expect, it } from "vitest";
import { PETS_CONTRACT, petPath } from "./chain";
import { homeRoute, inSetup, needsYou, setupGate, setupInProgress, showDeviceNudge, startRedirect } from "./flow";

const pet = (tokenId: string, name = `Pet ${tokenId}`) => ({ contract: PETS_CONTRACT, tokenId, name });

describe("homeRoute", () => {
  it("sends a new user (no pets) to setup", () => {
    expect(homeRoute([])).toEqual({ href: "/start", label: "Hatch your first pet" });
  });

  it("sends every owner with pets to Home", () => {
    expect(homeRoute([pet("7", "Hachiware")])).toEqual({ href: "/my", label: "Home" });
    expect(homeRoute([pet("1"), pet("2")])).toEqual({ href: "/my", label: "Home" });
  });
});

describe("startRedirect", () => {
  it("keeps new users in setup", () => {
    expect(startRedirect({ pets: [], hasDeviceLink: false, inSetup: false })).toBeNull();
  });

  it("sends existing users home instead of re-running setup", () => {
    expect(startRedirect({ pets: [pet("7")], hasDeviceLink: false, inSetup: false })).toBe("/my");
    expect(startRedirect({ pets: [pet("1"), pet("2")], hasDeviceLink: false, inSetup: false })).toBe("/my");
  });

  it("keeps existing users who scanned a Petto's QR (they pick which pet lives on it)", () => {
    expect(startRedirect({ pets: [pet("7")], hasDeviceLink: true, inSetup: false })).toBeNull();
  });

  it("never interrupts a setup in progress (the pet just hatched in step 2)", () => {
    expect(startRedirect({ pets: [pet("7")], hasDeviceLink: false, inSetup: true })).toBeNull();
  });

  it("knows when a stored wizard is still in progress: a pet picked but not customised yet", () => {
    expect(setupInProgress({ petRef: `${PETS_CONTRACT}:7`, customised: false })).toBe(true);
    expect(setupInProgress({ petRef: null, customised: false })).toBe(false);
    // hatched and customised: only the optional device step is left, so a later visit goes home
    expect(setupInProgress({ petRef: `${PETS_CONTRACT}:7`, customised: true })).toBe(false);
  });
});

describe("showDeviceNudge", () => {
  it("shows the owner a 'Connect your Petto' card until a device is paired", () => {
    expect(showDeviceNudge({ isOwner: true, paired: false, dismissed: false })).toBe(true);
    expect(showDeviceNudge({ isOwner: true, paired: true, dismissed: false })).toBe(false);
  });

  it("hides it after 'Not now' and for visitors", () => {
    expect(showDeviceNudge({ isOwner: true, paired: false, dismissed: true })).toBe(false);
    expect(showDeviceNudge({ isOwner: false, paired: false, dismissed: false })).toBe(false);
  });
});

describe("needsYou", () => {
  const base = { contract: PETS_CONTRACT, fuelLeft: 10, fuelLow: false, hatched: true, unread: 0, paired: true };
  const p = (tokenId: string, name: string, o: Partial<typeof base> = {}) => ({ ...base, tokenId, name, ...o });

  it("is empty when every pet is fine", () => {
    expect(needsYou([p("1", "Mochi")], new Set())).toEqual([]);
  });

  it("lists what needs the owner, most urgent first", () => {
    const items = needsYou(
      [
        p("1", "Mochi", { paired: false }),
        p("2", "Sprout", { fuelLeft: 0, fuelLow: true }),
        p("3", "Bao", { unread: 2 }),
        p("4", "Kiki", { fuelLeft: 3, fuelLow: true }),
        p("5", "Egg", { hatched: false }),
      ],
      new Set(),
    );
    expect(items.map((i) => i.text)).toEqual([
      "Sprout is out of fuel. Feed Sprout",
      "Kiki is low on fuel: 3 thoughts left",
      "Egg is waiting to hatch",
      "Bao sent you 2 messages",
      "Mochi has no Petto device yet",
    ]);
    expect(items[0]!.href).toBe(`/feed/${encodeURIComponent(`${PETS_CONTRACT}:2`)}`);
    expect(items[4]!.href).toBe(petPath(PETS_CONTRACT, "1", "/device"));
  });

  it("leaves out the device reminder the owner dismissed with Not now", () => {
    expect(needsYou([p("1", "Mochi", { paired: false })], new Set([`${PETS_CONTRACT}:1`]))).toEqual([]);
  });
});

describe("inSetup", () => {
  it("is true on the setup screens, where the app nav is hidden", () => {
    for (const p of ["/start", "/hatch", "/login", "/go"]) expect(inSetup(p)).toBe(true);
    expect(inSetup("/start/anything")).toBe(true);
  });

  it("is false in the app and on look-alike paths", () => {
    for (const p of ["/", "/my", "/shop", "/battle", "/pet/x:1", "/starter", "/adopt"]) expect(inSetup(p)).toBe(false);
  });
});

describe("setupGate", () => {
  it("sends a connected wallet with no pet from the app pages to setup", () => {
    for (const path of ["/my", "/shop", "/battle", "/battle/ABCD", "/wallet"]) {
      expect(setupGate({ path, account: "new.testnet", pets: 0 })).toBe("/start");
    }
  });

  it("leaves owners, signed-out visitors, unknown pet counts and open pages alone", () => {
    expect(setupGate({ path: "/shop", account: "old.testnet", pets: 2 })).toBeNull();
    expect(setupGate({ path: "/shop", account: null, pets: 0 })).toBeNull();
    expect(setupGate({ path: "/shop", account: "new.testnet", pets: null })).toBeNull(); // lookup failed: never lock out
    for (const path of ["/", "/start", "/login", "/p/x:1", "/pet/x:1", "/feed/x:1", "/receipt/abc", "/privacy", "/shopping"]) {
      expect(setupGate({ path, account: "new.testnet", pets: 0 })).toBeNull();
    }
  });
});
