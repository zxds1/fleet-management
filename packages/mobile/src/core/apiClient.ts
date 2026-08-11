// packages/mobile/src/core/apiClient.ts
//
// Typed HTTP client bound to the frozen `api/openapi.yaml` contract. Pure (injected fetch) so it is
// unit-testable in node. Responsibilities per the docs:
//   • C5.1 — attach `Idempotency-Key` on every state-changing (non-GET) request.
//   • C5.3 — never log secrets (no Authorization value, no bodies containing tokens).
//   • 08 §1 — normalize `{ error_code, message, fields }` into an `AppError`.
//   • D7 — parse the `CursorPage` envelope and return `.data` + pagination cursor.
//   • Validate responses against `@fleet/shared` schemas when a schema is supplied.

import { z } from "zod";
import { fromServer } from "./error";
import { randomUUID } from "./uuid";
import type { Security, PinnedEndpoint } from "./security";

export interface ApiClientDeps {
  baseUrl: string;
  fetchImpl: typeof fetch;
  /** Returns the bearer token for the active session, or undefined when offline. */
  getToken: () => string | undefined;
  /** Clock for testing. */
  now?: () => number;
  /** Injects an idempotency-key generator for tests. */
  makeIdempotencyKey?: () => string;
  /** Security layer for certificate pin verification (S-4). When provided, every request is gated by
   * `verifyPinBeforeRequest()` before the network call is made. */
  security?: Security;
}

export class ApiError extends Error {
  constructor(public readonly appError: ReturnType<typeof fromServer>) {
    super(appError.message || appError.code);
    this.name = "ApiError";
  }
}

export class PinVerificationError extends Error {
  constructor(public readonly host: string) {
    super(`Certificate pin verification failed for host: ${host}`);
    this.name = "PinVerificationError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Override idempotency key (e.g. when retrying a queued item). */
  idempotencyKey?: string;
  /** Extra headers (locale, etc.). */
  headers?: Record<string, string>;
  /** Skip auth (login itself). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const CursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  });

/** Extracts the hostname from a URL or path string. */
function extractHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export class ApiClient {
  constructor(private readonly deps: ApiClientDeps) {}

  /** API origin. Needed to build `<Image>` source URIs for media the app only knows by id. */
  get baseUrl(): string {
    return this.deps.baseUrl;
  }

  /**
   * Certificate pin verification gate (S-4). Extracts the host from the request URL,
   * looks up the configured SPKI pins from `app.json.extra.security.certPins`, and
   * verifies that the server's presented certificate pin matches one of the allowed pins.
   *
   * The presented pin is obtained from the `x-cert-pin` response header set by the
   * native TLS layer (the fetch wrapper validates the cert chain and exposes the SPKI
   * hash so the JS layer can perform the RFC 7469 pin-sha256 check without trusting
   * the system trust store alone).
   *
   * Fails closed: any error or missing pin → throws `PinVerificationError`.
   * When no `security` port is injected (e.g. tests), this is a no-op pass-through.
   */
  async verifyPinBeforeRequest(url: string): Promise<void> {
    if (!this.deps.security) return;
    const host = extractHost(url);
    if (!host) {
      throw new PinVerificationError(url);
    }

    const endpoint = this.deps.security.config.pins.find((p: PinnedEndpoint) => p.host === host);
    if (!endpoint) {
      return;
    }

    const presentedPin = (this.deps.fetchImpl as typeof fetch & { __lastCertPin?: string })?.__lastCertPin;
    const valid = presentedPin ? this.deps.security.verifyPin(host, presentedPin) : false;
    if (!valid) {
      throw new PinVerificationError(host);
    }
  }

  /**
    * Low-level request. Exposed (not just private) because the session/consent/device modules need
    * to hit auth endpoints without going through the typed object/page helpers. Returns the parsed
    * JSON for 2xx, or throws `ApiError` carrying the normalized `AppError` for error responses.
    */
  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(opts.headers ?? {}),
    };
    if (!opts.anonymous) {
      const token = this.deps.getToken();
      if (token) headers["authorization"] = `Bearer ${token}`;
    }
    if (method !== "GET" && method !== "DELETE") {
      headers["idempotency-key"] =
        opts.idempotencyKey || this.deps.makeIdempotencyKey?.() || randomUUID();
    }
    if (method === "GET") headers["accept"] = "application/json";

    const url = `${this.deps.baseUrl}${path}`;
    await this.verifyPinBeforeRequest(url);

    const res = await this.deps.fetchImpl(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const errBody =
        json && typeof json === "object" && "error_code" in json
          ? json
          : { error_code: "UNKNOWN", message: res.statusText };
      throw new ApiError(fromServer(errBody));
    }

    return json as T;
  }

  /** Single object response (validated when `schema` is given). */
  async getObject<T>(path: string, schema?: z.ZodType<T>): Promise<T> {
    const data = await this.request<T>(path, { method: "GET" });
    return schema ? schema.parse(data) : data;
  }

  /** Cursor-paginated list (D7). Returns the envelope; callers loop on `nextCursor`. */
  async getPage<T>(path: string, schema: z.ZodType<T>): Promise<CursorPage<T>> {
    const raw = await this.request<unknown>(path, { method: "GET" });
    const parsed = CursorPageSchema(schema).parse(raw);
    return { data: parsed.data, nextCursor: parsed.next_cursor, hasMore: parsed.has_more };
  }

  /** State-changing call with an idempotency key. */
  async send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>(path, { method, body, idempotencyKey });
  }
}
