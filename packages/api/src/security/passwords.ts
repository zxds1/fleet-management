// packages/api/src/security/passwords.ts
// argon2id password hashing (02 §2). The driver PIN is NEVER hashed here — it exists only in the
// device keystore (B12); the server stores device_id_hash and a device-bound refresh token.

import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

// OWASP-aligned argon2id parameters, sized for an API pod.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

export const argon2idHasher: PasswordHasher = {
  async hash(plain: string): Promise<string> {
    return argonHash(plain, OPTIONS);
  },
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argonVerify(hash, plain, OPTIONS);
    } catch {
      // A malformed stored hash must read as "wrong password", never as a 500.
      return false;
    }
  },
};
