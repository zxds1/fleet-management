import { newId } from './uuid';
import { MAX_ATTEMPTS, RETRY_MAX_MS } from './policy';
import { classifyResponse } from './errors';
import type { MediaOwnerKind, MediaRetentionClass } from '@fleet/shared';

export type QueueStatus = 'PENDING' | 'INFLIGHT' | 'DONE' | 'FAILED_REVIEW' | 'DISCARDED';
/** A photo saved on the device, waiting to be uploaded. `token` is a placeholder UUID used in the write body. */
export interface StagedUpload {
  token: string; uri: string; content_type: string; owner_kind: MediaOwnerKind; retention_class: MediaRetentionClass;
  width_px?: number; height_px?: number; client_captured_at?: string;
}
/**
 * S-11 resolved against the routers. After this write succeeds, `response[field]` is saved under
 * `token` so a later write can reference it:
 *   `POST /shifts/clock-in`      -> `shift_id`
 *   `POST /accidents`            -> `accident_id`
 *   `POST /inspections`          -> `inspection_id`
 *   `POST /trailer/swap`         -> `trailer_assignment_id`
 *   `POST /driver/fuel/purchase` -> `fuel_purchase_id`
 * There is no `fuel_record_id` anywhere: nothing in the API creates an `app.fuel_records` row.
 */
export interface Produces { token: string; field: string }

export interface QueuedWrite {
  id: number;
  idempotency_key: string;
  method: 'POST' | 'PUT' | 'PATCH';
  path: string;
  body: unknown;
  status: QueueStatus;
  attempts: number;
  uploads: StagedUpload[];       // photos to upload (and substitute into body) before sending
  produces: Produces | null;     // id this write creates for later writes (e.g. fuel gauge records)
  needs: string[];               // tokens from other writes that this body depends on
  response: unknown;             // the server's body once DONE (e.g. refuel's open_anomalies)
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

/** Storage port. SQLite in the app (sqliteQueueStore.ts), in-memory in tests. */
export interface QueueStore {
  insert(w: Omit<QueuedWrite, 'id'>): Promise<number>;
  get(id: number): Promise<QueuedWrite | null>;
  list(statuses: QueueStatus[]): Promise<QueuedWrite[]>;   // oldest first
  update(id: number, patch: Partial<Omit<QueuedWrite, 'id'>>): Promise<void>;
  remove(id: number): Promise<void>;
  clear(): Promise<void>;
  getRefs(): Promise<Record<string, string>>;     // token -> real id
  setRef(token: string, value: string): Promise<void>;
}

export interface SendResult { status: number; body: unknown }
export interface DrainDeps {
  store: QueueStore;
  /** Performs the HTTP call. Throws on network failure. Must send the stored Idempotency-Key unchanged. */
  send: (w: QueuedWrite) => Promise<SendResult>;
  /** Resolves false when the 24h offline auth ceiling has passed. */
  /** Uploads one staged photo (presign + PUT) and returns media_object_id. Throws on network failure. */
  uploadStaged?: (u: StagedUpload) => Promise<{ status: number; media_object_id?: string; body?: unknown }>;
  authCeilingOk: () => Promise<boolean>;
  onDone?: (w: QueuedWrite) => void;
  onDiscarded?: (w: QueuedWrite) => void;
  onAuthExpired?: () => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  uuid?: () => string;
}

export interface DrainReport { done: number; failedReview: number; discarded: number; stoppedBecause: 'EMPTY' | 'OFFLINE' | 'AUTH' | 'BUSY' | 'BACKOFF' }

// B-04 (decided): 6 in-flight retries, bounded by the same MAX_ATTEMPTS the item itself gets; the
// per-item backoff ceiling is the same RETRY_MAX_MS the drain scheduler uses (5 min).
const MAX_INFLIGHT_RETRIES = MAX_ATTEMPTS;
const MAX_BACKOFF_MS = RETRY_MAX_MS;

export class OfflineQueue {
  private draining = false;
  constructor(private readonly d: DrainDeps) {}
  private now() { return (this.d.now ?? Date.now)(); }
  private uuid() { return (this.d.uuid ?? newId)(); }
  private sleep(ms: number) { return (this.d.sleep ?? ((m) => new Promise<void>((r) => setTimeout(r, m))))(ms); }

  async enqueue(method: QueuedWrite['method'], path: string, body: unknown, idempotencyKey?: string, extra: { uploads?: StagedUpload[]; produces?: Produces; needs?: string[] } = {}): Promise<number> {
    const t = this.now();
    return this.d.store.insert({
      idempotency_key: idempotencyKey ?? this.uuid(), method, path, body,
      status: 'PENDING', attempts: 0, uploads: extra.uploads ?? [], produces: extra.produces ?? null, needs: extra.needs ?? [],
      response: null, error_code: null, error_message: null, created_at: t, updated_at: t,
    });
  }

  /** Call once at startup: a crash mid-request leaves INFLIGHT rows. Same key is replay-safe, so just re-queue them. */
  async recoverInflight() {
    for (const w of await this.d.store.list(['INFLIGHT'])) await this.d.store.update(w.id, { status: 'PENDING', updated_at: this.now() });
  }

  /**
   * Serial drain, oldest first. Order matters (clock-in must land before refuel), so a retryable
   * failure stops the whole pass instead of skipping ahead; a hard 4xx parks that one item for review and continues.
   */
  /** B-04 (decided): 6 attempts per item with 5 s -> 5 min backoff, and IDEMPOTENCY_INFLIGHT retried
   *  up to 6 times before the item is left PENDING. Chosen to ride out a full-shift outage while still
   *  surfacing a stuck item to a human inside the same shift. */
  async drain(): Promise<DrainReport> {
    const report: DrainReport = { done: 0, failedReview: 0, discarded: 0, stoppedBecause: 'EMPTY' };
    if (this.draining) return { ...report, stoppedBecause: 'BUSY' };
    this.draining = true;
    try {
      if (!(await this.d.authCeilingOk())) { this.d.onAuthExpired?.(); return { ...report, stoppedBecause: 'AUTH' }; }
      for (const item of await this.d.store.list(['PENDING'])) {
        const r = await this.drainOne(item);
        if (r === 'DONE') report.done++;
        else if (r === 'FAILED_REVIEW') report.failedReview++;
        else if (r === 'DISCARDED') report.discarded++;
        else return { ...report, stoppedBecause: r };
      }
      return report;
    } finally { this.draining = false; }
  }

  private async drainOne(item: QueuedWrite): Promise<'DONE' | 'FAILED_REVIEW' | 'DISCARDED' | 'OFFLINE' | 'BACKOFF' | 'AUTH'> {
    let wait = 1000;
    for (let i = 0; i < MAX_INFLIGHT_RETRIES; i++) {
      await this.d.store.update(item.id, { status: 'INFLIGHT', attempts: item.attempts + 1, updated_at: this.now() });
      // 1. upload staged photos (skips ones already uploaded on an earlier attempt), 2. substitute tokens, 3. send.
      const staged = await this.resolveStaged(item);
      if (staged.kind !== 'ok') {
        if (staged.kind === 'NETWORK') { await this.park(item.id); return 'OFFLINE'; }
        if (staged.kind === 'RETRY_LATER') { await this.park(item.id); return 'BACKOFF'; }
        await this.d.store.update(item.id, { status: 'FAILED_REVIEW', error_code: staged.code, error_message: staged.message ?? null, updated_at: this.now() });
        return 'FAILED_REVIEW';
      }
      let res: SendResult;
      try { res = await this.d.send({ ...item, body: staged.body, path: staged.path }); }
      catch { await this.park(item.id); return 'OFFLINE'; }

      const code = (res.body as { error_code?: string } | null)?.error_code;
      const outcome = classifyResponse(res.status, code);
      const fresh = (await this.d.store.get(item.id)) ?? item;
      switch (outcome) {
        case 'DONE':
          if (item.produces) {
            const v = (res.body as Record<string, unknown> | null)?.[item.produces.field];
            if (typeof v === 'string') await this.d.store.setRef(item.produces.token, v);
          }
          await this.d.store.update(item.id, { status: 'DONE', response: res.body ?? null, error_code: null, error_message: null, updated_at: this.now() });
          this.d.onDone?.(fresh); return 'DONE';
        case 'DISCARD':
          await this.d.store.update(item.id, { status: 'DISCARDED', error_code: code ?? null, updated_at: this.now() });
          this.d.onDiscarded?.(fresh); return 'DISCARDED';
        case 'INFLIGHT_RETRY':
          await this.sleep(wait); wait = Math.min(wait * 2, MAX_BACKOFF_MS); continue;
        case 'REFRESH_AUTH':
          await this.park(item.id); this.d.onAuthExpired?.(); return 'AUTH';
        case 'RETRY_LATER':
          await this.park(item.id); return 'BACKOFF';
        case 'FAILED_REVIEW': {
          const b = res.body as { detail?: string; title?: string } | null;
          await this.d.store.update(item.id, {
            status: 'FAILED_REVIEW', error_code: code ?? `HTTP_${res.status}`,
            error_message: b?.detail ?? b?.title ?? null, updated_at: this.now(),
          });
          return 'FAILED_REVIEW';
        }
      }
    }
    await this.park(item.id); return 'BACKOFF';
  }

  private async resolveStaged(item: QueuedWrite): Promise<
    | { kind: 'ok'; body: unknown; path: string } | { kind: 'NETWORK' } | { kind: 'RETRY_LATER' } | { kind: 'FAILED'; code: string; message?: string }> {
    let refs = await this.d.store.getRefs();
    for (const u of item.uploads) {
      if (refs[u.token]) continue;
      if (!this.d.uploadStaged) return { kind: 'FAILED', code: 'UPLOAD_UNAVAILABLE' };
      let r;
      try { r = await this.d.uploadStaged(u); } catch { return { kind: 'NETWORK' }; }
      if (r.status >= 200 && r.status < 300 && r.media_object_id) { await this.d.store.setRef(u.token, r.media_object_id); refs = { ...refs, [u.token]: r.media_object_id }; continue; }
      const out = classifyResponse(r.status, (r.body as { error_code?: string } | null)?.error_code);
      if (out === 'RETRY_LATER' || out === 'REFRESH_AUTH' || out === 'INFLIGHT_RETRY') return { kind: 'RETRY_LATER' };
      return { kind: 'FAILED', code: (r.body as { error_code?: string } | null)?.error_code ?? `UPLOAD_HTTP_${r.status}` };
    }
    const missing = item.needs.find((t) => !refs[t]);
    if (missing) return { kind: 'FAILED', code: 'DEPENDENCY_FAILED', message: 'An earlier step this depends on did not complete.' };
    return { kind: 'ok', body: substituteTokens(item.body, refs), path: substitutePath(item.path, refs) };
  }

  private park(id: number) { return this.d.store.update(id, { status: 'PENDING', updated_at: this.now() }); }

  // ---- Outbox actions -------------------------------------------------------
  getItem(id: number) { return this.d.store.get(id); }
  outbox() { return this.d.store.list(['PENDING', 'INFLIGHT', 'FAILED_REVIEW']); }
  /** Retry: same body, same key. Safe because the server replays or rejects identically. */
  retry(id: number) { return this.d.store.update(id, { status: 'PENDING', error_code: null, error_message: null, updated_at: this.now() }); }
  /** Edit: a changed body MUST get a new key, otherwise the server answers IDEMPOTENCY_CONFLICT. */
  edit(id: number, body: unknown) {
    return this.d.store.update(id, { body, idempotency_key: this.uuid(), status: 'PENDING', error_code: null, error_message: null, updated_at: this.now() });
  }
  discard(id: number) { return this.d.store.remove(id); }
  clearAll() { return this.d.store.clear(); }
}

/** Query keys to invalidate after a queued write lands, keyed on the real route prefixes. */
export function queryKeysForPath(path: string): string[][] {
  if (path.startsWith('/shifts/')) return [['shift-active']];
  if (path.startsWith('/fuel/') || path.startsWith('/driver/fuel/')) return [['fuel-history'], ['admin-fuel-pending']];
  if (path.startsWith('/inspections')) return [['dvir-queue'], ['dvir-list']];
  if (path.startsWith('/accidents')) return [['accidents']];
  if (path.startsWith('/trailer/')) return [['shift-active'], ['vehicle-states']];
  return [];
}

/** Deep-replaces any string equal to a known token with its real id. */
export function substituteTokens(v: unknown, refs: Record<string, string>): unknown {
  if (typeof v === 'string') return refs[v] ?? v;
  if (Array.isArray(v)) return v.map((x) => substituteTokens(x, refs));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substituteTokens(x, refs)]));
  return v;
}

/** Tokens may appear inside URL paths too, e.g. /accidents/<token>/media. */
export function substitutePath(path: string, refs: Record<string, string>): string {
  return Object.entries(refs).reduce((p, [t, v]) => p.split(t).join(v), path);
}

export type { QueuedWrite as QueueItem };
