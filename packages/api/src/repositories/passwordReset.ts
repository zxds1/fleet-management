// packages/api/src/repositories/passwordReset.ts
// Password-reset delegation store (16_password_reset.sql). Parameterised SQL only.

import { BaseRepository } from "@fleet/db";
import type { DbClient, PasswordResetCodeRow, PasswordResetStatus } from "@fleet/shared";

export class ResetCodeRepository extends BaseRepository<PasswordResetCodeRow> {
  constructor(client: DbClient) {
    super(client, "app.password_reset_codes", { deletedAtColumn: null });
  }

  /** Public read-accessor for the underlying client (used by the reset service for raw inserts). */
  get dbClient(): DbClient {
    return this.client;
  }

  /** Find a live reset request by id (used by the approver + verify paths). */
  async findById(id: string): Promise<PasswordResetCodeRow | null> {
    const res = await this.client.query<PasswordResetCodeRow>(
      `SELECT * FROM app.password_reset_codes WHERE id = $1 LIMIT 1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  /**
   * The most recent live reset for a user (PENDING_APPROVAL or APPROVED and not yet expired).
   * Used by the verify/complete path to validate a submitted code without exposing the id.
   */
  async findLiveByUser(userId: string): Promise<PasswordResetCodeRow | null> {
    const res = await this.client.query<PasswordResetCodeRow>(
      `SELECT * FROM app.password_reset_codes
         WHERE user_id = $1 AND status IN ('PENDING_APPROVAL', 'APPROVED')
           AND expires_at > now()
         ORDER BY requested_at DESC
         LIMIT 1`,
      [userId],
    );
    return res.rows[0] ?? null;
  }

  /** Pending resets awaiting a given approver (admin console list). */
  async listPendingForApprover(tenantId: string, approverUserId: string): Promise<PasswordResetCodeRow[]> {
    const res = await this.client.query<PasswordResetCodeRow>(
      `SELECT * FROM app.password_reset_codes
         WHERE tenant_id = $1 AND approver_user_id = $2 AND status = 'PENDING_APPROVAL'
           AND expires_at > now()
         ORDER BY requested_at ASC`,
      [tenantId, approverUserId],
    );
    return res.rows;
  }

  async markApproved(id: string, approvedBy: string): Promise<void> {
    await this.client.query(
      `UPDATE app.password_reset_codes
          SET status = 'APPROVED', approved_by = $2, approved_at = now()
        WHERE id = $1 AND status = 'PENDING_APPROVAL'`,
      [id, approvedBy],
    );
  }

  async markDelivered(id: string): Promise<void> {
    await this.client.query(
      `UPDATE app.password_reset_codes SET delivered_at = now() WHERE id = $1`,
      [id],
    );
  }

  async markCompleted(id: string): Promise<void> {
    await this.client.query(
      `UPDATE app.password_reset_codes SET status = 'COMPLETED', completed_at = now() WHERE id = $1`,
      [id],
    );
  }

  async markExpired(id: string): Promise<void> {
    await this.client.query(
      `UPDATE app.password_reset_codes SET status = 'EXPIRED' WHERE id = $1 AND status <> 'COMPLETED'`,
      [id],
    );
  }

  async revokeAllForUser(userId: string, reason: PasswordResetStatus = "REVOKED"): Promise<void> {
    await this.client.query(
      `UPDATE app.password_reset_codes
          SET status = $2
        WHERE user_id = $1 AND status IN ('PENDING_APPROVAL', 'APPROVED')`,
      [userId, reason],
    );
  }
}
