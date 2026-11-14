import { describe, expect, it } from "vitest";
import { PETS_CONTRACT, petPath } from "./chain";
import { homeRoute, inSetup, needsYou, showDeviceNudge, startRedirect } from "./flow";

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
    expect(startRedirect({ pets: [], hasDeviceLink: false, wizardPetRef: null })).toBeNull();
  });

  it("sends existing users home instead of re-running setup", () => {
    expect(startRedirect({ pets: [pet("7")], hasDeviceLink: false, wizardPetRef: null })).toBe("/my");
    expect(startRedirect({ pets: [pet("1"), pet("2")], hasDeviceLink: false, wizardPetRef: null })).toBe("/my");
  });

  it("keeps existing users who scanned a Petto's QR (they pick which pet lives on it)", () => {
    expect(startRedirect({ pets: [pet("7")], hasDeviceLink: true, wizardPetRef: null })).toBeNull();
  });

  it("never interrupts a setup in progress (the pet just hatched in step 2)", () => {
    expect(startRedirect({ pets: [pet("7")], hasDeviceLink: false, wizardPetRef: `${PETS_CONTRACT}:7` })).toBeNull();
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
    for (const p of ["/", "/my", "/shop", "/race", "/pet/x:1", "/starter", "/adopt"]) expect(inSetup(p)).toBe(false);
  });
});
