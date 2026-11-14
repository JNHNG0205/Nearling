// Where people go, decided by what they own on chain (not by setup progress in this browser):
// no pets = new user (setup), otherwise Home (/my). Pure, so it is tested.
import { formatPetRef } from "@petto/shared";
import { petPath } from "./chain";

export interface FlowPet {
  contract: string;
  tokenId: string;
  name: string;
}

/** The signed-in owner's starting point, with the label for the button that leads there. */
export function homeRoute(pets: FlowPet[]): { href: string; label: string } {
  if (pets.length === 0) return { href: "/start", label: "Hatch your first pet" };
  return { href: "/my", label: "Home" };
}

/**
 * Where /start sends an existing owner instead of re-running setup, or null to stay: new users,
 * people who came from a Petto's QR (they pick which pet lives on it) and a setup in progress
 * (`setupInProgress`: a pet just hatched in step 2) all stay.
 */
export function startRedirect(o: { pets: FlowPet[]; hasDeviceLink: boolean; inSetup: boolean }): string | null {
  if (o.pets.length === 0 || o.hasDeviceLink || o.inSetup) return null;
  return homeRoute(o.pets).href;
}

/**
 * A stored wizard still in progress: a pet picked or hatched but not customised yet. Once it is,
 * only the optional device step is left (also offered on every pet page), so a later visit to
 * /start goes home instead of reopening setup.
 */
export function setupInProgress(w: { petRef: string | null; customised: boolean }): boolean {
  return w.petRef !== null && !w.customised;
}

/** Setup screens (wallet, hatch, pairing): the header hides the app nav there, so setup is finished before the app opens. */
const SETUP_ROUTES = ["/start", "/hatch", "/login", "/go"];
export function inSetup(path: string): boolean {
  return SETUP_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
}

/** App pages that need a pet of your own. Public pages, setup, pet and feed pages stay open to anyone. */
const NEEDS_PET = ["/my", "/shop", "/battle", "/wallet"];

/**
 * Where a connected wallet with no pet goes instead of an app page (setup), or null to stay.
 * `pets` null = the lookup failed: never lock anyone out on a flaky RPC.
 */
export function setupGate(o: { path: string; account: string | null; pets: number | null }): string | null {
  if (!o.account || o.pets === null || o.pets > 0) return null;
  return NEEDS_PET.some((r) => o.path === r || o.path.startsWith(`${r}/`)) ? "/start" : null;
}

/** "Connect your Petto" on the pet home: the owner, no device paired, not dismissed. */
export function showDeviceNudge(o: { isOwner: boolean; paired: boolean; dismissed: boolean }): boolean {
  return o.isOwner && !o.paired && !o.dismissed;
}

/** localStorage key for "Not now" on the device card, per pet. */
export const deviceNudgeKey = (petRef: string) => `petto.device-nudge-dismissed.${petRef}`;

export interface HomePet {
  contract: string;
  tokenId: string;
  name: string;
  fuelLeft: number;
  fuelLow: boolean;
  hatched: boolean;
  unread: number;
  paired: boolean;
}

export interface NeedItem {
  key: string;
  text: string;
  href: string;
  /** urgent items (no fuel) are highlighted */
  urgent: boolean;
}

/**
 * Home's "Needs you": what the owner's pets want, most urgent first (no fuel, low fuel, not
 * hatched, unread messages, no device). `dismissedDevice` holds pet refs whose device reminder
 * got "Not now".
 */
export function needsYou(pets: HomePet[], dismissedDevice: Set<string>): NeedItem[] {
  const out: (NeedItem & { rank: number })[] = [];
  for (const p of pets) {
    const ref = formatPetRef(p.contract, p.tokenId);
    const feed = `/feed/${encodeURIComponent(ref)}`;
    if (p.fuelLeft === 0) out.push({ rank: 0, key: `${ref}:fuel`, text: `${p.name} is out of fuel. Feed ${p.name}`, href: feed, urgent: true });
    else if (p.fuelLow) {
      out.push({ rank: 1, key: `${ref}:fuel`, text: `${p.name} is low on fuel: ${p.fuelLeft} thoughts left`, href: feed, urgent: false });
    }
    if (!p.hatched) out.push({ rank: 2, key: `${ref}:hatch`, text: `${p.name} is waiting to hatch`, href: petPath(p.contract, p.tokenId), urgent: false });
    if (p.unread > 0) {
      const n = p.unread === 1 ? "a message" : `${p.unread} messages`;
      out.push({ rank: 3, key: `${ref}:inbox`, text: `${p.name} sent you ${n}`, href: petPath(p.contract, p.tokenId), urgent: false });
    }
    if (!p.paired && !dismissedDevice.has(ref)) {
      out.push({ rank: 4, key: `${ref}:device`, text: `${p.name} has no Petto device yet`, href: petPath(p.contract, p.tokenId, "/device"), urgent: false });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...item }) => item);
}
