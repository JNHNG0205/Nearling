import { log } from "../log";

/**
 * Pinata client for public pet metadata (docs/IPFS.md). Uses the v3 Files API for both the PNG
 * and the JSON, so the bytes we hash are exactly the bytes pinned (pinJSONToIPFS re-serialises).
 *
 * `POST https://uploads.pinata.cloud/v3/files`, Bearer JWT, multipart `file`, `network=public`,
 * `name`; response `{ data: { id, cid, is_duplicate, ... } }` (docs.pinata.cloud, checked 2026-11-11).
 * [VERIFY] live: CIDv1 by default, and the same bytes give the same CID (`is_duplicate: true`).
 */
export const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

export interface Pinata {
  enabled: boolean;
  /** Pins bytes to public IPFS and returns the CID. Throws on any non-2xx (status only, never the body). */
  pin(bytes: Uint8Array, name: string, mime: string): Promise<string>;
  /** HTTPS gateway URL for a CID. */
  gatewayUrl(cid: string): string;
}

export function gatewayBase(gateway: string | undefined): string {
  if (!gateway) return "https://ipfs.io";
  const host = gateway.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}`;
}

export function createPinata(
  cfg: { PINATA_JWT?: string; PINATA_GATEWAY?: string },
  fetchFn: typeof fetch = fetch,
): Pinata {
  const base = gatewayBase(cfg.PINATA_GATEWAY);
  const gatewayUrl = (cid: string) => `${base}/ipfs/${cid}`;
  const jwt = cfg.PINATA_JWT?.trim();
  if (!jwt) {
    return {
      enabled: false,
      pin: async () => {
        throw new Error("pinata disabled");
      },
      gatewayUrl,
    };
  }
  return {
    enabled: true,
    gatewayUrl,
    async pin(bytes, name, mime) {
      const form = new FormData();
      form.append("network", "public");
      form.append("name", name);
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
      const started = Date.now();
      const res = await fetchFn(PINATA_UPLOAD_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
      });
      if (!res.ok) {
        log.warn("pinata pin failed", { status: res.status, name });
        throw new Error(`pinata ${res.status}`);
      }
      const out = (await res.json()) as { data?: { cid?: unknown; is_duplicate?: unknown } };
      const cid = out.data?.cid;
      if (typeof cid !== "string" || cid.length === 0) throw new Error("pinata: no cid in response");
      log.info("pinata pinned", { name, cid, duplicate: out.data?.is_duplicate === true, ms: Date.now() - started });
      return cid;
    },
  };
}
