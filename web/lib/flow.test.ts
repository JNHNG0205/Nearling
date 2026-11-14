import { describe, expect, it } from "vitest";
import { PETS_CONTRACT, petPath } from "./chain";
import { homeRoute, showDeviceNudge, startRedirect } from "./flow";

const pet = (tokenId: string, name = `Pet ${tokenId}`) => ({ contract: PETS_CONTRACT, tokenId, name });

describe("homeRoute", () => {
  it("sends a new user (no pets) to setup", () => {
    expect(homeRoute([])).toEqual({ href: "/start", label: "Hatch your first pet" });
  });

  it("opens the only pet directly", () => {
    expect(homeRoute([pet("7", "Hachiware")])).toEqual({ href: petPath(PETS_CONTRACT, "7"), label: "Open Hachiware" });
  });

  it("lists several pets on My pets", () => {
    expect(homeRoute([pet("1"), pet("2")])).toEqual({ href: "/my", label: "My pets" });
  });
});

describe("startRedirect", () => {
  it("keeps new users in setup", () => {
    expect(startRedirect({ pets: [], hasDeviceLink: false, wizardPetRef: null })).toBeNull();
  });

  it("sends existing users home instead of re-running setup", () => {
    expect(startRedirect({ pets: [pet("7")], hasDeviceLink: false, wizardPetRef: null })).toBe(petPath(PETS_CONTRACT, "7"));
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
