// packages/shared/src/secrets.ts
// Secrets adapter (audit L11). Abstracts secret retrieval so services never read
// `process.env` directly for credentials. Two implementations:
//  – EnvSecretsClient: reads from env vars, validates required secrets at boot.
//  – VaultSecretsClient: reads from a Vault KV-v2 endpoint (VAULT_ADDR / VAULT_TOKEN),
//    falling back to env when Vault is unreachable or the secret is absent.
// getSecretsClient() picks the right one based on VAULT_ADDR.

import { logger } from "./logging";

export interface SecretsClient {
  /** Returns the secret value for `key`, or undefined when not found. */
  get(key: string): Promise<string | undefined>;
  /** Returns all available secrets as key→value pairs. */
  getAll(): Promise<Record<string, string>>;
}

/** Default required secrets validated at boot when constructed with no args. */
const DEFAULT_REQUIRED_SECRETS: string[] = [];

/**
 * Env-backed secret store. Validates that every secret in `required` is present
 * at construction time so a misconfigured service fails fast at boot rather
 * than discovering the missing secret mid-request (security Layer 3).
 */
export class EnvSecretsClient implements SecretsClient {
  private readonly required: readonly string[];

  constructor(requiredSecrets: string[] = DEFAULT_REQUIRED_SECRETS) {
    this.required = requiredSecrets;
    this.validate();
  }

  private validate(): void {
    const missing = this.required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      logger.error("secrets_validation_failed", { missing, count: missing.length });
      throw new Error(`Missing required environment secrets: ${missing.join(", ")}`);
    }
  }

  async get(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async getAll(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of this.required) {
      const value = process.env[key];
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
}

export interface VaultSecretsOptions {
  address: string;
  token?: string;
  mount?: string;
  /** When true (default), falls back to env vars if Vault returns 404/403 or is unreachable. */
  fallbackToEnv?: boolean;
}

/**
 * Vault KV-v2 secret store. Fetches secrets via HTTP from `${VAULT_ADDR}/v1/${mount}/data/${key}`.
 * Falls back to process.env on 404/403 or when Vault is unreachable, so a Vault outage
 * never breaks service startup (R-109 degrade-to-env pattern).
 */
export class VaultSecretsClient implements SecretsClient {
  private readonly address: string;
  private readonly token: string | undefined;
  private readonly mount: string;
  private readonly fallbackToEnv: boolean;

  constructor(opts: VaultSecretsOptions) {
    this.address = opts.address.replace(/\/$/, "");
    this.token = opts.token;
    this.mount = opts.mount ?? "secret";
    this.fallbackToEnv = opts.fallbackToEnv ?? true;
  }

  private async fetchFromVault(key: string): Promise<{ data: Record<string, string> } | null> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers["X-Vault-Token"] = this.token;
    const url = `${this.address}/v1/${this.mount}/data/${key}`;
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      logger.warn("vault_unreachable", { key, message: e instanceof Error ? e.message : String(e) });
      return null;
    }
    if (!res.ok) {
      logger.warn("vault_secret_fetch_failed", { key, status: res.status });
      return null;
    }
    const body = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    const secretData = body?.data?.data ?? {};
    return { data: Object.fromEntries(Object.entries(secretData).map(([k, v]) => [k, String(v)])) };
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const vault = await this.fetchFromVault(key);
      if (vault) {
        // Vault KV-v2 stores a single secret object; the key we want is a field in it.
        const val = vault.data[key];
        if (val !== undefined) return val;
        // Or the key itself is the path and the value is under `value`.
        const v = vault.data["value"];
        if (v !== undefined) return v;
      }
    } catch (e) {
      logger.warn("vault_get_error", { key, message: e instanceof Error ? e.message : String(e) });
    }
    if (this.fallbackToEnv) return process.env[key];
    return undefined;
  }

  async getAll(): Promise<Record<string, string>> {
    return Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as Record<string, string>;
  }
}

let cachedClient: SecretsClient | null = null;

/**
 * Factory: returns a VaultSecretsClient when VAULT_ADDR is set (Vault with env fallback),
 * otherwise an EnvSecretsClient. The result is memoised; call `resetSecretsClient()` between
 * tests or when re-configuring.
 */
export function getSecretsClient(): SecretsClient {
  if (cachedClient) return cachedClient;

  const vaultAddr = process.env.VAULT_ADDR;
  if (vaultAddr) {
    cachedClient = new VaultSecretsClient({
      address: vaultAddr,
      token: process.env.VAULT_TOKEN,
      fallbackToEnv: true,
    });
    logger.info("secrets client: vault", { address: vaultAddr });
  } else {
    cachedClient = new EnvSecretsClient();
    logger.info("secrets client: env");
  }

  return cachedClient;
}

/** Test hook — clears the memoised client so `getSecretsClient()` re-evaluates env. */
export function resetSecretsClient(): void {
  cachedClient = null;
}
