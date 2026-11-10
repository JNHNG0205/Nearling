import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM with a per-pet key: HKDF-SHA256(master, salt "nearling-mem-v1", info petRef).
 * Blob layout: iv (12) | ciphertext | tag (16). Honest limit: whoever holds the master key can read.
 */
export function createSealer(masterKey: Buffer) {
  if (masterKey.length !== 32) throw new Error("MEMORY_MASTER_KEY must be 32 bytes (base64)");
  const keyFor = (petRef: string) =>
    Buffer.from(hkdfSync("sha256", masterKey, "nearling-mem-v1", petRef, 32));

  return {
    seal(petRef: string, plaintext: string): Buffer {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", keyFor(petRef), iv);
      const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
      return Buffer.concat([iv, ct, c.getAuthTag()]);
    },
    open(petRef: string, blob: Buffer): string {
      const iv = blob.subarray(0, 12);
      const tag = blob.subarray(blob.length - 16);
      const ct = blob.subarray(12, blob.length - 16);
      const d = createDecipheriv("aes-256-gcm", keyFor(petRef), iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
    },
  };
}

export type Sealer = ReturnType<typeof createSealer>;
