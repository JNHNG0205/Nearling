// Bluetooth LE pairing service (docs/hardware/DEVICE_PROTOCOL.md section 9).
// Fixed 128-bit UUIDs, shared by the firmware (copy the strings) and the web (Web Bluetooth).
// Values fixed by the /start wizard (web/lib/ble.ts): 6e6c000N-8a3c-4b5e-9f2a-6e6561726c67, N = 1 service, 2 pairing_url, 3 device_pk. Never change them.

/** GATT primary service advertised by every Petto while it shows a pairing code. */
export const BLE_SERVICE_UUID = "6e6c0001-8a3c-4b5e-9f2a-6e6561726c67";

/** Read + notify, UTF-8: `<PUBLIC_WEB_URL>/hatch?t=<pairing token>` (the same URL as the QR code; token 4 to 128 chars [A-Za-z0-9_-]). */
export const BLE_PAIRING_URL_UUID = "6e6c0002-8a3c-4b5e-9f2a-6e6561726c67";

/** Read, UTF-8: the device's NEAR public key, `ed25519:<base58>`. */
export const BLE_DEVICE_PK_UUID = "6e6c0003-8a3c-4b5e-9f2a-6e6561726c67";

/** Advertised local name prefix, followed by the last 4 hex chars of `hw_id` (e.g. `Petto-3F2A`). */
export const BLE_NAME_PREFIX = "Petto-";
