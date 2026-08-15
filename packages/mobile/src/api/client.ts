/**
 * Thin typed fetch wrapper around the live FleetPulse API.
 *
 * Mirrors kotlin-app HttpClient.kt (AuthInterceptor):
 *  - attaches `Authorization: Bearer <token>` when a token is set
 *  - attaches an `Idempotency-Key` (UUID) to every state-changing request
 *  - attaches an `x-request-id`
 *  - parses RFC7807 problem responses into `AppError` (carrying `error_code`)
 */

export class AppError extends Error {
  errorCode: string;
  status: number;
  detail?: string;
  constructor(errorCode: string, message: string, status: number, detail?: string) {
    super(message);
    this.name = "AppError";
    this.errorCode = errorCode;
    this.status = status;
    this.detail = detail;
  }
}

function uuid(): string {
  // RN has no crypto.randomUUID on older runtimes; fall back to a v4-ish uuid.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** Force an idempotency key (used by the offline queue drainer to replay the SAME key). */
  idempotencyKey?: string;
  /** Skip auth header (used by /auth/login). */
  anonymous?: boolean;
  /** Query string (already encoded). */
  query?: string;
}

class ApiClient {
  private token: string | null = null;
  baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private buildHeaders(opts: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {};
    if (!opts.anonymous && this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const isStateChanging = opts.method && opts.method !== "GET";
    if (isStateChanging) {
      headers["Idempotency-Key"] = opts.idempotencyKey || uuid();
    }
    if (opts.method === "GET") headers["Accept"] = "application/json";
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (!headers["x-request-id"]) headers["x-request-id"] = uuid();
    return headers;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const url = `${this.baseUrl}${path}${opts.query ? `?${opts.query}` : ""}`;
    const res = await fetch(url, {
      method,
      headers: this.buildHeaders({ ...opts, method }),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      // RFC7807 problem response: { type, title, status, detail, instance, error_code }
      const code = (data && data.error_code) || `HTTP_${res.status}`;
      const message = (data && (data.title || data.detail)) || res.statusText;
      const detail = data && data.detail;
      throw new AppError(code, message, res.status, detail);
    }
    return data as T;
  }

  get<T>(path: string, query?: string): Promise<T> {
    return this.request<T>(path, { method: "GET", query });
  }
  post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>(path, { method: "POST", body, idempotencyKey });
  }
  put<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>(path, { method: "PUT", body, idempotencyKey });
  }
  patch<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body, idempotencyKey });
  }
  del<T>(path: string, idempotencyKey?: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE", idempotencyKey });
  }
}

export const apiClient = new ApiClient(
  (require("../config").API_BASE_URL) as string,
);

