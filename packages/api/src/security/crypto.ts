// packages/api/src/security/crypto.ts
// AES-GCM envelope for users.mfa_secret_encrypted (02 §3) plus the hashing helpers used for
// recovery codes and device identifiers. The TOTP seed is never returned in clear.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) {
      throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes (base64 encoded)");
    }
    this.key = key;
  }

  /** iv || tag || ciphertext, stored in the bytea column. */
  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(envelope: Buffer): string {
    const iv = envelope.subarray(0, IV_BYTES);
    const tag = envelope.subarray(IV_BYTES, IV_BYTES + 16);
    const ciphertext = envelope.subarray(IV_BYTES + 16);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Stable hash of a normalised request body — the idempotency guard (C5.1). */
export function stableHash(value: unknown): string {
  return sha256Hex(canonicalise(value));
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`);
  return `{${entries.join(",")}}`;
}

/** MFA recovery codes are shown once and stored hashed (02 §3). */
export function generateRecoveryCodes(count = 10): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: count }, () =>
    randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-"),
  );
  return { plain, hashed: plain.map(sha256Hex) };
}
