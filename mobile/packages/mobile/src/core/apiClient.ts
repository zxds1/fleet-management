import type { ZodType } from 'zod';
import { newId } from './uuid';
import { AppError, NetworkError, parseProblem } from '@fleet/shared';

export interface ApiDeps {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  /** Exchanges the refresh token. Must resolve with the new access token or null. */
  refreshAccessToken: () => Promise<string | null>;
  onAuthLost?: () => void;
  /** Called for every error response with its error_code, e.g. to react to ACCOUNT_SUSPENDED anywhere in the app. */
  onErrorCode?: (code: string, status: number) => void;
  fetchImpl?: typeof fetch;
  uuid?: () => string;
}

export interface RequestOpts<T> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  schema?: ZodType<T>;
  idempotencyKey?: string;
  auth?: boolean;
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiClient {
  private readonly f: typeof fetch;
  private readonly uuid: () => string;
  private refreshing: Promise<string | null> | null = null;

  constructor(private readonly deps: ApiDeps) {
    this.f = deps.fetchImpl ?? fetch;
    this.uuid = deps.uuid ?? newId;
  }

  get<T = unknown>(path: string, opts: RequestOpts<T> = {}) { return this.request<T>('GET', path, opts); }
  post<T = unknown>(path: string, opts: RequestOpts<T> = {}) { return this.request<T>('POST', path, opts); }
  put<T = unknown>(path: string, opts: RequestOpts<T> = {}) { return this.request<T>('PUT', path, opts); }
  patch<T = unknown>(path: string, opts: RequestOpts<T> = {}) { return this.request<T>('PATCH', path, opts); }

  buildUrl(path: string, query?: RequestOpts<unknown>['query']) {
    const qs = Object.entries(query ?? {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${this.deps.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  async request<T>(method: string, path: string, opts: RequestOpts<T> = {}): Promise<T> {
    // Rule 1: every write carries an Idempotency-Key. One key per logical operation, reused across the 401 retry.
    const idem = WRITE.has(method) ? (opts.idempotencyKey ?? this.uuid()) : undefined;
    let res = await this.send(method, path, opts, idem, await this.token(opts));
    if (res.status === 401 && opts.auth !== false) {
      const fresh = await this.refreshOnce();
      if (!fresh) { this.deps.onAuthLost?.(); throw await this.toError(res); }
      res = await this.send(method, path, opts, idem, fresh);
    }
    if (!res.ok) throw await this.toError(res);
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json();
    return opts.schema ? opts.schema.parse(json) : (json as T);
  }

  private token(opts: RequestOpts<unknown>) { return opts.auth === false ? Promise.resolve(null) : this.deps.getAccessToken(); }

  private refreshOnce() {
    // Collapse concurrent 401s into one refresh call; refresh tokens rotate and a double-spend would log the user out.
    this.refreshing ??= this.deps.refreshAccessToken().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async send(method: string, path: string, opts: RequestOpts<unknown>, idem: string | undefined, token: string | null) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (idem) headers['Idempotency-Key'] = idem;
    try {
      return await this.f(this.buildUrl(path, opts.query), {
        method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) { throw new NetworkError(e); }
  }

  private async toError(res: Response): Promise<AppError> {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    const err = parseProblem(res.status, body); this.deps.onErrorCode?.(err.error_code, err.status); return err;
  }

  /**
   * E-06 resolved: `GET /media/{id}` does NOT return a JSON `{ url }`. The route answers 302 with a
   * `Location` header pointing at a short-lived presigned GET (`packages/api/src/http/routes/media.ts`
   * `res.redirect(302, presign)`). So a reader follows the redirect once, with the bearer token, and
   * hands the resulting object-storage URL to the image loader — which never sees the token.
   */
  async resolveMediaUrl(path: string): Promise<string> {
    const headers: Record<string, string> = { Accept: 'image/*' };
    const token = await this.deps.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await this.f(this.buildUrl(path), { method: 'GET', headers, redirect: 'manual' });
    } catch (e) { throw new NetworkError(e); }
    if (res.status === 401) {
      const fresh = await this.refreshOnce();
      if (!fresh) { this.deps.onAuthLost?.(); throw parseProblem(401, null); }
      return this.resolveMediaUrl(path);
    }
    if (res.status >= 400) throw await this.toError(res);   // 3xx is the answer here, not a failure
    const location = res.headers.get('Location');
    if (!location) throw new AppErrorRedirectMissing();
    return location;
  }
}

/** 302 without a Location: the media service is misconfigured, and the screen shows an error. */
class AppErrorRedirectMissing extends Error {
  constructor() { super('MEDIA_REDIRECT_MISSING'); this.name = 'AppErrorRedirectMissing'; }
}
