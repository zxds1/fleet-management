import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { ENDPOINTS, url } from './api/endpoints';
import { newId } from './core/uuid';
import { ApiClient } from './core/apiClient';
import { SessionService, type SecretStore } from './core/session';
import { ConfigClient } from '@fleet/shared';
import { OfflineQueue, queryKeysForPath, type Produces, type StagedUpload } from './core/offlineQueue';
import { openSqliteQueueStore } from './core/sqliteQueueStore';
import {
  AppError,
  ClientProblemError,
  DeviceRefreshResponseSchema,
  MediaUploadResponseSchema,
  NetworkError,
  SessionResponseSchema,
  ConsentStatusSchema,
  principalFromSessionBody,
  type ConsentStatus,
  type ConsentType,
  type MediaOwnerKind,
  type MediaRetentionClass,
  type Principal,
  type SessionResponse,
} from '@fleet/shared';
import { Directory, File, Paths } from 'expo-file-system';
import { clearDiskCache } from './cache';
import { DrainScheduler } from './core/drainScheduler';
import { API_BASE_URL } from './config';
import { useUi } from './state/store';
import i18n from './i18n';

const secrets: SecretStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  del: (k) => SecureStore.deleteItemAsync(k),
};

/**
 * Thresholds are seeded locally from the backend's `CONFIG_DEFAULTS`: there is no `GET /config`, and
 * a safety rule such as the 24 h offline ceiling must hold with no network at all.
 */
export const config = new ConfigClient();

export const session = new SessionService({
  config,
  secrets,
  sha256: (s) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s),
});

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, networkMode: 'offlineFirst' } } });
export { QueryClientProvider };

/** The last trusted session body, so a cold start can rebuild the Principal without a login. */
let lastSession: SessionResponse | null = null;
export const lastSessionBody = (): SessionResponse | null => lastSession;

/** True when the last refresh failed because of connectivity (do NOT log the user out). */
export let refreshNetworkFailed = false;

/** Keeps the in-memory Principal in step with the trusted session body. Never decodes the JWT. */
export function syncPrincipal(body: SessionResponse | null): void {
  lastSession = body;
  const p: Principal | null = principalFromSessionBody(body);
  useUi.getState().setPrincipal(p);
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh_token = await session.getRefreshToken();
  if (!refresh_token) return null;
  refreshNetworkFailed = false;
  try {
    const r = await new ApiClient({ baseUrl: API_BASE_URL, getAccessToken: async () => null, refreshAccessToken: async () => null })
      .post(url(ENDPOINTS.refresh), { body: { refresh_token }, schema: SessionResponseSchema, auth: false });
    await session.saveTokens({ access_token: r.access_token, refresh_token: r.refresh_token, roles: r.roles });
    syncPrincipal(r);
    return r.access_token;
  } catch (e) {
    refreshNetworkFailed = e instanceof NetworkError;
    if (e instanceof AppError && e.error_code === 'ACCOUNT_SUSPENDED') void onSuspended();
    if (e instanceof AppError && (e.error_code === 'SESSION_REVOKED' || e.error_code === 'UNAUTHENTICATED')) void signOut();
    return null;
  }
}

/** Access tokens live in memory only, so after a cold start this refreshes once before the socket or first call needs one. */
export const ensureAccessToken = async (): Promise<string | null> => (await session.getAccessToken()) ?? refreshAccessToken();

export const api = new ApiClient({
  baseUrl: API_BASE_URL,
  getAccessToken: () => session.getAccessToken(),
  refreshAccessToken: () => refreshAccessToken(),
  onAuthLost: () => { void signOut(); },
  onErrorCode: (code) => { if (code === 'ACCOUNT_SUSPENDED') void onSuspended(); },
});

/**
 * Binds this phone to the account the moment a session exists. Best effort: a failure here must never
 * block a driver from signing in, it only means the offline PIN / push path is not set up yet, and
 * Settings offers "Retry device registration".
 */
export async function registerDeviceAfterLogin(): Promise<boolean> {
  try {
    const { registerDevice } = await import('./device');
    await registerDevice();
    return true;
  } catch {
    return false;
  }
}

/** Asks the server for the device-bound refresh token and its authoritative `offline_until`. */
export async function bindDeviceRefreshToken(): Promise<string | null> {
  const r = await api.post(url(ENDPOINTS.refreshDeviceToken), { schema: DeviceRefreshResponseSchema });
  await SecureStore.setItemAsync('refresh_token', r.refresh_token);
  await session.saveTokens({ access_token: (await session.getAccessToken()) ?? '', refresh_token: r.refresh_token, offline_until: r.offline_until });
  return r.offline_until;
}

let queue: OfflineQueue | null = null;
export async function getQueue(): Promise<OfflineQueue> {
  if (queue) return queue;
  const store = await openSqliteQueueStore();
  queue = new OfflineQueue({
    store,
    // B-10: a presigned URL is requested fresh on every upload attempt; a failed PUT is retried, not reused.
    uploadStaged: async (u) => {
      let p;
      try {
        p = await api.post(url(ENDPOINTS.uploadUrl), {
          schema: MediaUploadResponseSchema,
          body: { owner_kind: u.owner_kind, retention_class: u.retention_class, content_type: u.content_type, width_px: u.width_px, height_px: u.height_px, client_captured_at: u.client_captured_at },
        });
      } catch (e) {
        if (e instanceof AppError) return { status: e.status, body: { error_code: e.error_code } };
        throw e;
      }
      const blob = await (await fetch(u.uri)).blob();          // throws if offline -> queue pauses and resumes later
      const put = await fetch(p.upload_url, { method: p.method, headers: { 'Content-Type': u.content_type }, body: blob });
      if (!put.ok) return { status: 503 };                      // expired/failed presign: re-presign on the next pass
      try { new File(u.uri).delete(); } catch { /* already gone */ }
      return { status: 201, media_object_id: p.media_object_id };
    },
    authCeilingOk: async () => (await session.checkAuthCeiling()).ok,
    send: async (w) => {
      const token = await session.getAccessToken();
      const res = await fetch(`${API_BASE_URL}${w.path}`, {
        method: w.method,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': w.idempotency_key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(w.body),
      });
      let body: unknown = null;
      try { body = await res.json(); } catch { /* 204 */ }
      return { status: res.status, body };
    },
    onDone: (w) => queryKeysForPath(w.path).forEach((queryKey) => void queryClient.invalidateQueries({ queryKey })),
    onDiscarded: () => useUi.getState().showToast(i18n.t('outbox.discardedToast')),
    onAuthExpired: () => useUi.getState().setAuth('signedOut'),
  });
  await queue.recoverInflight();
  return queue;
}

/** Retries stuck writes with backoff. Kicked on start, foreground, reconnect and manual flush. */
export const drainScheduler = new DrainScheduler({ drain: async () => (await getQueue()).drain() });

/** Deletes staged photos/videos that are waiting to upload. */
function wipeOutboxFiles(): void {
  try { const d = new Directory(Paths.document, 'outbox'); if (d.exists) d.delete(); } catch { /* nothing staged */ }
}

/**
 * Queued writes and staged media belong to the person who made them. If a DIFFERENT person signs in
 * on this device, the previous person's unsent work is destroyed rather than replayed under the new
 * person's token.
 */
export async function reconcileQueueOwner(userId: string): Promise<void> {
  if (!userId) return;
  const prev = await SecureStore.getItemAsync('queue_owner');
  if (prev && prev !== userId) { await (await getQueue()).clearAll(); wipeOutboxFiles(); await refreshOutboxCount(); }
  await SecureStore.setItemAsync('queue_owner', userId);
}

export const refreshOutboxCount = async (): Promise<void> => useUi.getState().setOutboxCount((await (await getQueue()).outbox()).length);

/**
 * C-16: consent is recorded server-side, per consent type, against the server's own policy version.
 * `GET /me/consent` is the authority (C5.5); `POST /consent` takes `{ consent_type, policy_version,
 * accepted }`. The version the app sends is the `required_version` the gate reported, so a version
 * bump cannot leave a driver on stale consent.
 */
export async function consentStatus(): Promise<ConsentStatus> {
  return api.get(url(ENDPOINTS.consentStatus), { schema: ConsentStatusSchema });
}

export async function acceptConsent(consent_type: ConsentType): Promise<void> {
  const gate = await consentStatus();
  await api.post(url(ENDPOINTS.acceptConsent), { body: { consent_type, policy_version: gate.required_version, accepted: true } });
  await secrets.set('consent_version', gate.required_version);
  queryKeysForPath('/auth/consent').forEach((k) => void queryClient.invalidateQueries({ queryKey: k }));
}

/** True when the gate says the person must (re)accept before clocking in. */
export async function consentSatisfied(): Promise<boolean> {
  try { return (await consentStatus()).consented; } catch { return true; }   // the server enforces it anyway; offline must not block the form
}

/** Every driver write goes through here: try online with a fixed key, queue with the SAME key if the network is down. */
export async function writeOrQueue(path: string, body: unknown): Promise<{ queued: boolean }> {
  const key = newId();
  try {
    await api.post(path, { body, idempotencyKey: key });
    queryKeysForPath(path).forEach((k) => void queryClient.invalidateQueries({ queryKey: k }));
    return { queued: false };
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;      // hard errors surface to the form; only connectivity failures queue
    await (await getQueue()).enqueue('POST', path, body, key);
    await refreshOutboxCount();
    return { queued: true };
  }
}

/** Copies a camera capture into app storage so it survives cache purges until it is uploaded. */
export function stagePhoto(
  photo: { uri: string; width: number; height: number; kind?: 'photo' | 'video' },
  owner_kind: MediaOwnerKind,
  retention_class: MediaRetentionClass,
): StagedUpload {
  const token = newId();          // a real UUID so the body's placeholder passes the server's uuid() check
  const video = photo.kind === 'video';
  const dir = new Directory(Paths.document, 'outbox');
  if (!dir.exists) dir.create();
  const dest = new File(dir, `${token}.${video ? 'mp4' : 'jpg'}`);
  new File(photo.uri).copy(dest);
  return {
    token, uri: dest.uri, content_type: video ? 'video/mp4' : 'image/jpeg', owner_kind, retention_class,
    width_px: video ? undefined : photo.width, height_px: video ? undefined : photo.height,
    client_captured_at: new Date().toISOString(),
  };
}

/**
 * The response body of the most recent SUCCESSFUL submit, so a caller can read a server-authored message
 * that is not part of the queue row — specifically the clock-in `disclaimer` (E-11). Cleared by
 * `clearLastSubmitResponse` once shown, so it is never replayed on the next submit.
 */
let lastSubmit: unknown = null;
export const lastSubmitResponse = async (): Promise<unknown> => lastSubmit;
export const clearLastSubmitResponse = async (): Promise<void> => { lastSubmit = null; };

export interface StagedOp {
  path: string;
  body: unknown;
  uploads?: StagedUpload[];
  produces?: Produces;
  needs?: string[];
}

/**
 * Queue-first submit for forms with photos or dependent records. Enqueues every op in order, drains
 * immediately, then reports: SENT, QUEUED (offline, in Outbox), or throws the server's AppError (and
 * removes these rows so the driver fixes it in the form).
 */
export async function submitStaged(ops: StagedOp[]): Promise<{ queued: boolean; responses: unknown[] }> {
  const q = await getQueue();
  const ids: number[] = [];
  for (const op of ops) ids.push(await q.enqueue('POST', op.path, op.body, undefined, { uploads: op.uploads, produces: op.produces, needs: op.needs }));
  await q.drain();
  const rows = (await Promise.all(ids.map((id) => q.getItem(id)))).filter((r) => r != null);
  const failed = rows.find((r) => r.status === 'FAILED_REVIEW' && r.error_code !== 'DEPENDENCY_FAILED') ?? rows.find((r) => r.status === 'FAILED_REVIEW');
  if (failed) {
    for (const id of ids) await q.discard(id);
    await refreshOutboxCount();
    throw new ClientProblemError(422, failed.error_code ?? 'UNKNOWN', 'Rejected', failed.error_message ?? undefined);
  }
  await refreshOutboxCount();
  const queued = rows.some((r) => r.status !== 'DONE');
  if (queued) drainScheduler.arm();
  const responses = rows.map((r) => r.response).filter((x) => x != null);
  // The last response is kept for the clock-in disclaimer (E-11); a FAILED_REVIEW path never gets here.
  if (responses.length) lastSubmit = responses[responses.length - 1];
  return { queued, responses };
}

/** Suspension mid-session: wipe everything cached and show the Suspended screen (no further navigation). */
export async function onSuspended(): Promise<void> {
  queryClient.clear();
  clearDiskCache();
  await (await getQueue()).clearAll();
  wipeOutboxFiles();
  await session.signOut();
  syncPrincipal(null);
  useUi.getState().setAuth('suspended');
}

export async function signOut(): Promise<void> {
  try { await api.post(url(ENDPOINTS.logout)); } catch { /* best effort */ }
  queryClient.clear();
  clearDiskCache();
  await session.signOut();
  syncPrincipal(null);
  useUi.getState().reset();
}