// Petto Bluetooth pairing (Web Bluetooth, one GATT read).
// The UUIDs come from `packages/device/src/ble.ts`, the single source shared with the firmware.
import { BLE_PAIRING_URL_UUID, BLE_SERVICE_UUID } from "@petto/device";

/** GATT primary service the Petto advertises while it shows its pairing QR. */
export const NEARLING_BLE_SERVICE_UUID = BLE_SERVICE_UUID;
/** Read-only characteristic `pairing_url`: UTF-8 text, the same `/hatch?t=<token>` URL the QR encodes. */
export const NEARLING_BLE_PAIRING_URL_UUID = BLE_PAIRING_URL_UUID;

// Minimal Web Bluetooth types (not in TypeScript's DOM lib).
interface GattCharacteristic {
  readValue(): Promise<DataView>;
}
interface GattService {
  getCharacteristic(uuid: string): Promise<GattCharacteristic>;
}
interface GattServer {
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<GattService>;
}
interface BluetoothLike {
  requestDevice(options: { filters: { services: string[] }[] }): Promise<{ gatt?: GattServer }>;
}

function bluetooth(): BluetoothLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth ?? null;
}

/** Web Bluetooth exists in Chrome, Edge and Android Chrome only (not Safari or any iOS browser), on HTTPS or localhost. */
export function hasWebBluetooth(): boolean {
  return bluetooth() !== null && typeof window !== "undefined" && window.isSecureContext;
}

/**
 * Turns the text the device sent into a same-origin `/hatch?t=<token>` path, or null.
 * Only the token is kept, so a device can never send the browser to another site.
 */
export function hatchPathFromPairingUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), "https://nearling.invalid");
  } catch {
    return null;
  }
  const t = url.searchParams.get("t");
  if (url.pathname.replace(/\/+$/, "") !== "/hatch" || !t || !/^[A-Za-z0-9_-]{4,128}$/.test(t)) return null;
  return `/hatch?t=${encodeURIComponent(t)}`;
}

export type BleResult =
  | { ok: true; path: string }
  | { ok: false; reason: "unsupported" | "cancelled" | "bad_url" | "failed" };

/** Opens the browser's device chooser (Pettos only), reads `pairing_url` and returns the local hatch path. */
export async function readPairingUrlOverBle(): Promise<BleResult> {
  const bt = bluetooth();
  if (!bt) return { ok: false, reason: "unsupported" };
  let server: GattServer | null = null;
  try {
    const device = await bt.requestDevice({ filters: [{ services: [NEARLING_BLE_SERVICE_UUID] }] });
    if (!device.gatt) return { ok: false, reason: "failed" };
    server = await device.gatt.connect();
    const service = await server.getPrimaryService(NEARLING_BLE_SERVICE_UUID);
    const value = await (await service.getCharacteristic(NEARLING_BLE_PAIRING_URL_UUID)).readValue();
    const path = hatchPathFromPairingUrl(new TextDecoder().decode(value));
    return path ? { ok: true, path } : { ok: false, reason: "bad_url" };
  } catch (err) {
    // NotFoundError: the chooser closed without a pick
    if (err instanceof Error && err.name === "NotFoundError") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "failed" };
  } finally {
    server?.disconnect();
  }
}
