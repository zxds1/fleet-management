// packages/api/src/services/privacy.ts
// Data Subject Access Request (DSAR) service (15_privacy_requests.sql).
//
// GDPR Articles 15 (access), 17 (erasure), 20 (portability); mirrored by Kenya DPA 2019.
//
// Export flow: the driver submits a request → a privacy_requests row is created and
// an outbox event is staged (D8) so the background worker can generate the export.
// The worker marks the row PROCESSING -> READY when the file is in S3, at which
// point the authenticated GET /download returns a presigned URL and flips the status
// to DOWNLOADED.
//
// Deletion flow: a deletion-request row is created and an outbox event is staged.
// The worker performs the soft-delete (sets app.users.deleted_at, revokes every
// session + device). This service only creates the request; the actual deletion is
// the worker's job, so this method never touches user rows.
//
// Returns Result<T> and never throws for a domain rule (08 §1).

import type { Result, Tx } from "@fleet/shared";
import { ok, err, NotFound, Forbidden, violation } from "@fleet/shared";
import type { DbClient } from "@fleet/shared";
import type { MediaPresigner } from "../media/presigner";
import type { PrivacyRequestRow } from "@fleet/shared";
import type { PrivacyRequestRepository } from "../repositories/privacy";
import type { CursorPage } from "../http/pagination";
import { MAX_PAGE_LIMIT, decodeCursor, buildPage } from "../http/pagination";

/** Response body of `POST /privacy/export-request`. */
export interface ExportRequestOutcome {
  request_id: string;
  status: string;
  download_url: string | null;
}

/** Response body of `POST /privacy/deletion-request`. */
export interface DeletionRequestOutcome {
  request_id: string;
  status: string;
}

/** A request row projected for the list / detail views. Sensitive fields are stripped. */
export interface PrivacyRequestView {
  id: string;
  request_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  notes: string | null;
}

const SENSITIVE_USER_FIELDS = new Set([
  "password_hash",
  "refresh_token_hash",
  "mfa_secret_encrypted",
]);

/** Fields redacted from session rows (no token material). */
const REDACTED_SESSION_FIELDS = "redacted";

export class PrivacyService {
  constructor(
    private readonly privacy: PrivacyRequestRepository,
    private readonly presigner: MediaPresigner,
    private readonly exportBucket: string,
  ) {}

  // ── Export request ───────────────────────────────────────────────────────────

  /**
   * Creates an EXPORT privacy_requests row + stages an outbox event for the worker.
   * The worker will: query all user data → serialise → upload to S3 → set READY +
   * populate download_token / file_key. The API returns 202 Accepted immediately.
   */
  async createExportRequest(
    tx: Tx,
    userId: string,
    tenantId: string,
    notes?: string | null,
  ): Promise<Result<ExportRequestOutcome>> {
    const row = await this.privacy.create({
      tenantId,
      userId,
      requestType: "EXPORT",
      notes: notes ?? null,
    });

    tx.registerOutbox({
      event_type: "privacy.export.requested",
      aggregate_type: "privacy_request",
      aggregate_id: row.id,
      payload: {
        user_id: userId,
        tenant_id: tenantId,
        request_id: row.id,
      },
    });

    return ok({
      request_id: row.id,
      status: row.status,
      download_url: null,
    });
  }

  // ── Deletion request ─────────────────────────────────────────────────────────

  /**
   * Creates a DELETION privacy_requests row + stages an outbox event for the worker.
   * The worker performs the soft-delete cascade (users.deleted_at, revoke sessions,
   * revoke devices). This service never touches user rows directly.
   */
  async createDeletionRequest(
    tx: Tx,
    userId: string,
    tenantId: string,
    reason: string,
  ): Promise<Result<DeletionRequestOutcome>> {
    const row = await this.privacy.create({
      tenantId,
      userId,
      requestType: "DELETION",
      notes: reason,
    });

    tx.registerOutbox({
      event_type: "privacy.deletion.requested",
      aggregate_type: "privacy_request",
      aggregate_id: row.id,
      payload: {
        user_id: userId,
        tenant_id: tenantId,
        request_id: row.id,
        reason,
      },
    });

    return ok({
      request_id: row.id,
      status: row.status,
    });
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  /** The driver's own request history (NEWEST). */
  async listOwn(
    client: DbClient,
    userId: string,
    opts: { limit: number; cursor?: string | null },
  ): Promise<Result<CursorPage<PrivacyRequestView>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor ?? undefined);
    const rows = await this.privacy.listForUser(userId, {
      limit: limit + 1,
      ...(cursor ? { cursor } : {}),
    });
    return ok(buildPage(rows, limit, toCursor));
  }

  /** Single request detail for the owner. */
  async getOneForUser(client: DbClient, id: string, userId: string): Promise<Result<PrivacyRequestView>> {
    const row = await this.privacy.findByIdForUser(id, userId);
    if (!row) return err(new NotFound("Privacy request not found"));
    return ok(toView(row));
  }

  /** Admin/manager: tenant-wide request listing. */
  async listForTenant(
    client: DbClient,
    opts: { limit: number; cursor?: string | null; statuses?: string[] },
  ): Promise<Result<CursorPage<PrivacyRequestView>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor ?? undefined);
    const rows = await this.privacy.listForTenant({
      limit: limit + 1,
      ...(cursor ? { cursor } : {}),
      statuses: opts.statuses,
    });
    return ok(buildPage(rows, limit, toCursor));
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  /**
    * Returns a presigned GET URL for a READY export. The caller must own the row.
    * Marks the status DOWNLOADED on success.
    */
   async getDownloadUrl(
    client: DbClient,
    id: string,
    userId: string,
  ): Promise<Result<{ download_url: string; expires_in_seconds: number }>> {
    const row = await this.privacy.findByIdForUser(id, userId);
    if (!row) return err(new NotFound("Privacy request not found"));
    if (row.status !== "READY") {
      return err(
        violation(
          "PRIVACY_REQUEST_NOT_READY",
          "Export not ready",
          "The export has not been generated yet. Try again later.",
        ),
      );
    }
    if (!row.file_key) {
      return err(
        violation(
          "PRIVACY_REQUEST_NO_FILE",
          "Export file missing",
          "The export file is not available. Contact support.",
        ),
      );
    }

    const presigned = await this.presigner.presignGet(this.exportBucket, row.file_key, 600);
    const url = presigned.url;
    await this.privacy.markDownloaded(id);
    return ok({ download_url: url, expires_in_seconds: 600 });
  }

  // ── Export payload generation (worker-side stub) ─────────────────────────────
  // The real implementation gathers: user profile, consents, sessions (redacted),
  // shifts, fuel purchases, accidents, inspections, vehicle issues, driving analytics.
  // It excludes password_hash, refresh_token_hash, mfa_secret_encrypted.
  // This stub exists so the service is constructable and testable without S3/DB.

  /** Serialises the export payload for a user, stripping sensitive columns. */
  buildExportPayload(row: {
    user: Record<string, unknown>;
    consents: unknown[];
    sessions: unknown[];
    shifts: unknown[];
    fuel_purchases: unknown[];
    accidents: unknown[];
    inspections: unknown[];
    vehicle_issues: unknown[];
    driving_analytics: unknown[];
  }): Record<string, unknown> {
    const safeUser: Record<string, unknown> = { ...row.user };
    for (const field of SENSITIVE_USER_FIELDS) {
      if (field in safeUser) safeUser[field] = "[REDACTED]";
    }

    const safeSessions = Array.isArray(row.sessions)
      ? row.sessions.map((s) => ({
          ...(s as Record<string, unknown>),
          refresh_token_hash: "[REDACTED]",
        }))
      : row.sessions;

    return {
      generated_at: new Date().toISOString(),
      user: safeUser,
      consents: row.consents,
      sessions: safeSessions,
      shifts: row.shifts,
      fuel_purchases: row.fuel_purchases,
      accidents: row.accidents,
      inspections: row.inspections,
      vehicle_issues: row.vehicle_issues,
      driving_analytics: row.driving_analytics,
    };
  }
}

function toView(row: PrivacyRequestRow): PrivacyRequestView {
  return {
    id: row.id,
    request_type: row.request_type,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    notes: row.notes,
  };
}

function toCursor(row: PrivacyRequestRow): { sort: string; id: string } {
  return { sort: String(row.created_at), id: row.id };
}
