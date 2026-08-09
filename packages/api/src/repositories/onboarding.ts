// packages/api/src/repositories/onboarding.ts
// Driver onboarding + background-check repositories (13_onboarding.sql). Parameterised SQL only
// (06 §2); no business rules. `app.driver_onboarding` is soft-deletable (D3), so the default
// deleted_at handling of BaseRepository applies and every read filters on `deleted_at IS NULL`.

import { BaseRepository } from "@fleet/db";
import type { DbClient, DriverOnboardingRow } from "@fleet/shared";

/** Fields the driver may set on the profile step. All optional — a partial save is legal. */
export interface OnboardingProfilePatch {
  full_name?: string | null;
  licence_number?: string | null;
  licence_class?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  address_json?: unknown;
}

/** Fields captured by the background-check submission step. */
export interface BackgroundCheckPatch {
  ssn_encrypted?: string | null;
  dob?: string | null;
  previous_addresses_json?: unknown;
  consent_given: boolean;
}

/**
 * The driver's current dispatch assignment, joined to the vehicle plate so the onboarding screen
 * can show "your vehicle" without a second round-trip.
 */
export interface OnboardingAssignmentRow {
  assignment_id: string;
  assigned_date: string;
  status: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  trailer_id: string | null;
}

export class OnboardingRepository extends BaseRepository<DriverOnboardingRow> {
  constructor(client: DbClient) {
    super(client, "app.driver_onboarding");
  }

  /** Live onboarding row for a driver, or null. One row per driver (partial unique index). */
  async getByDriverId(driverId: string): Promise<DriverOnboardingRow | null> {
    const res = await this.client.query<DriverOnboardingRow>(
      `SELECT *
         FROM app.driver_onboarding
        WHERE driver_id = $1::uuid AND deleted_at IS NULL
        LIMIT 1`,
      [driverId],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Resolves the onboarding row from the *user* id by joining through app.drivers. Saves the
   * router a second query on the `/drivers/me/...` surface. Returns null when the user has no
   * driver profile or no onboarding row yet.
   */
  async getByUserId(userId: string): Promise<DriverOnboardingRow | null> {
    const res = await this.client.query<DriverOnboardingRow>(
      `SELECT o.*
         FROM app.driver_onboarding o
         JOIN app.drivers d ON d.id = o.driver_id
        WHERE d.user_id = $1::uuid
          AND d.deleted_at IS NULL
          AND o.deleted_at IS NULL
        LIMIT 1`,
      [userId],
    );
    return res.rows[0] ?? null;
  }

  /** Creates the initial NOT_SUBMITTED row for a driver. */
  async create(driverId: string): Promise<DriverOnboardingRow> {
    const res = await this.client.query<DriverOnboardingRow>(
      `INSERT INTO app.driver_onboarding (driver_id)
       VALUES ($1::uuid)
       RETURNING *`,
      [driverId],
    );
    return res.rows[0] as DriverOnboardingRow;
  }

  /**
   * Upserts the profile step against the live row for the driver. COALESCE keeps any column the
   * caller omitted, so partial saves never blank previously entered data.
   */
  async upsertProfile(driverId: string, patch: OnboardingProfilePatch): Promise<DriverOnboardingRow> {
    const res = await this.client.query<DriverOnboardingRow>(
      `INSERT INTO app.driver_onboarding
         (driver_id, full_name, licence_number, licence_class,
          emergency_contact_name, emergency_contact_phone, address_json)
       VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::jsonb)
       ON CONFLICT (driver_id) WHERE deleted_at IS NULL DO UPDATE
         SET full_name               = COALESCE(EXCLUDED.full_name,               app.driver_onboarding.full_name),
             licence_number          = COALESCE(EXCLUDED.licence_number,          app.driver_onboarding.licence_number),
             licence_class           = COALESCE(EXCLUDED.licence_class,           app.driver_onboarding.licence_class),
             emergency_contact_name  = COALESCE(EXCLUDED.emergency_contact_name,  app.driver_onboarding.emergency_contact_name),
             emergency_contact_phone = COALESCE(EXCLUDED.emergency_contact_phone, app.driver_onboarding.emergency_contact_phone),
             address_json            = COALESCE(EXCLUDED.address_json,            app.driver_onboarding.address_json)
       RETURNING *`,
      [
        driverId,
        patch.full_name ?? null,
        patch.licence_number ?? null,
        patch.licence_class ?? null,
        patch.emergency_contact_name ?? null,
        patch.emergency_contact_phone ?? null,
        patch.address_json === undefined ? null : JSON.stringify(patch.address_json),
      ],
    );
    return res.rows[0] as DriverOnboardingRow;
  }

  /**
   * Records the background-check submission: stores the ciphertext, moves the status to SUBMITTED
   * and stamps the submission + consent instants. `now()` comes from the DB so the timestamp is the
   * transaction clock, not the app server's.
   */
  async submitBackgroundCheck(driverId: string, patch: BackgroundCheckPatch): Promise<DriverOnboardingRow> {
    const res = await this.client.query<DriverOnboardingRow>(
      `INSERT INTO app.driver_onboarding
         (driver_id, ssn_encrypted, dob, previous_addresses_json,
          background_check_status, background_check_submitted_at, consent_given, consent_at)
       VALUES ($1::uuid, $2::text, $3::date, $4::jsonb,
               'SUBMITTED', now(), $5::boolean, CASE WHEN $5::boolean THEN now() ELSE NULL END)
       ON CONFLICT (driver_id) WHERE deleted_at IS NULL DO UPDATE
         SET ssn_encrypted                 = COALESCE(EXCLUDED.ssn_encrypted,           app.driver_onboarding.ssn_encrypted),
             dob                           = COALESCE(EXCLUDED.dob,                     app.driver_onboarding.dob),
             previous_addresses_json       = COALESCE(EXCLUDED.previous_addresses_json, app.driver_onboarding.previous_addresses_json),
             background_check_status       = 'SUBMITTED',
             background_check_submitted_at = now(),
             background_check_cleared_at   = NULL,
             consent_given                 = EXCLUDED.consent_given,
             consent_at                    = CASE WHEN EXCLUDED.consent_given THEN now() ELSE NULL END
       RETURNING *`,
      [
        driverId,
        patch.ssn_encrypted ?? null,
        patch.dob ?? null,
        patch.previous_addresses_json === undefined ? null : JSON.stringify(patch.previous_addresses_json),
        patch.consent_given,
      ],
    );
    return res.rows[0] as DriverOnboardingRow;
  }

  /**
   * Most recent dispatch assignment for the driver (04_assets.sql app.assignments), with the
   * vehicle plate joined in. Returns null when the driver has never been dispatched.
   */
  async getAssignment(driverId: string): Promise<OnboardingAssignmentRow | null> {
    const res = await this.client.query<OnboardingAssignmentRow>(
      `SELECT a.id            AS assignment_id,
              a.assigned_date::text AS assigned_date,
              a.status::text   AS status,
              a.vehicle_id,
              v.license_plate  AS vehicle_plate,
              a.trailer_id
         FROM app.assignments a
         LEFT JOIN app.vehicles v ON v.id = a.vehicle_id
        WHERE a.driver_id = $1::uuid
        ORDER BY a.assigned_date DESC, a.created_at DESC
        LIMIT 1`,
      [driverId],
    );
    return res.rows[0] ?? null;
  }
}
