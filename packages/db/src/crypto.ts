// packages/db/src/crypto.ts
// Field-level PII encryption via pgcrypto (audit L11, security Layer 3). These helpers
// generate SQL fragments that wrap a column/value expression in pgcrypto calls. The
// symmetric key is resolved at call time from the SecretsClient (`PII_ENCRYPTION_KEY`),
// never hardcoded — services inject the secrets client via `initPiiCrypto()`.

import type { SecretsClient } from "@fleet/shared";
import { logger } from "@fleet/shared";

let secrets: SecretsClient | null = null;

/** Inject the secrets client so `encryptPii`/`decryptPii`/`hashPii` can resolve PII_ENCRYPTION_KEY. */
export function initPiiCrypto(s: SecretsClient): void {
  secrets = s;
}

/** Test hook — clears the initialised secrets client. */
export function resetPiiCrypto(): void {
  secrets = null;
}

/** Resolves and validates the PII encryption key from the secrets client. */
export async function piiKey(): Promise<string> {
  if (!secrets) {
    throw new Error("PiiCrypto not initialized; call initPiiCrypto() with a SecretsClient");
  }
  const key = await secrets.get("PII_ENCRYPTION_KEY");
  if (!key) {
    throw new Error("PII_ENCRYPTION_KEY is not configured in the secrets store");
  }
  return key;
}

/** Quotes a string as a safe PostgreSQL string literal (escapes embedded single quotes). */
function sqlLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/**
 * Generates a SQL fragment using `pgp_sym_encrypt` to encrypt `sql` (a column reference
 * or bind-parameter expression) with the PII key.
 *
 * Example:  `await encryptPii("$1", "ssn")`  →  `pgp_sym_encrypt($1::text, '…key…')`
 */
export async function encryptPii(sql: string, column: string): Promise<string> {
  const key = await piiKey();
  logger.debug("pii encrypt", { column });
  return `pgp_sym_encrypt(${sql}::text, ${sqlLiteral(key)})`;
}

/**
 * Generates a SQL fragment using `pgp_sym_decrypt` to decrypt `sql` (a column holding
 * a `bytea` encrypted value) with the PII key.
 *
 * Example:  `await decryptPii("driver.ssn_encrypted", "ssn")`  →  `pgp_sym_decrypt(driver.ssn_encrypted, '…key…')::text`
 */
export async function decryptPii(sql: string, column: string): Promise<string> {
  const key = await piiKey();
  logger.debug("pii decrypt", { column });
  return `pgp_sym_decrypt(${sql}, ${sqlLiteral(key)})::text`;
}

/**
 * Generates a SQL fragment using `digest` to produce a keyed hash (SHA-256) of `sql`,
 * suitable for deterministic lookups on PII without storing the plaintext.
 *
 * Example:  `await hashPii("$1", "ssn")`  →  `encode(digest($1::text || '…key…', 'sha256'), 'hex')`
 */
export async function hashPii(sql: string, column: string): Promise<string> {
  const key = await piiKey();
  logger.debug("pii hash", { column });
  return `encode(digest(${sql}::text || ${sqlLiteral(key)}, 'sha256'), 'hex')`;
}
