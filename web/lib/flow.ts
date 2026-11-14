// Where people go, decided by what they own on chain (not by setup progress in this browser):
// no pets = new user (setup), one pet = its home, several = My pets. Pure, so it is tested.
import { petPath } from "./chain";

export interface FlowPet {
  contract: string;
  tokenId: string;
  name: string;
}

/** The signed-in owner's starting point, with the label for the button that leads there. */
export function homeRoute(pets: FlowPet[]): { href: string; label: string } {
  if (pets.length === 0) return { href: "/start", label: "Hatch your first pet" };
  if (pets.length === 1) return { href: petPath(pets[0]!.contract, pets[0]!.tokenId), label: `Open ${pets[0]!.name}` };
  return { href: "/my", label: "My pets" };
}

/**
 * Where /start sends an existing owner instead of re-running setup, or null to stay: new users,
 * people who came from a Petto's QR (they pick which pet lives on it) and a setup in progress
 * (a pet just hatched in step 2) all stay.
 */
export function startRedirect(o: { pets: FlowPet[]; hasDeviceLink: boolean; wizardPetRef: string | null }): string | null {
  if (o.pets.length === 0 || o.hasDeviceLink || o.wizardPetRef) return null;
  return homeRoute(o.pets).href;
}

/** "Connect your Petto" on the pet home: the owner, no device paired, not dismissed. */
export function showDeviceNudge(o: { isOwner: boolean; paired: boolean; dismissed: boolean }): boolean {
  return o.isOwner && !o.paired && !o.dismissed;
}

/** localStorage key for "Not now" on the device card, per pet. */
export const deviceNudgeKey = (petRef: string) => `petto.device-nudge-dismissed.${petRef}`;
