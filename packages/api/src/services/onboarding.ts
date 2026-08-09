// packages/api/src/services/onboarding.ts
// Driver onboarding + background-check service. Pure business rules over OnboardingRepository;
// returns Result<T> and never throws for domain rules (08 §1). Runs inside the request transaction
// (D8) for the write paths. The SSN ciphertext is stored but never returned — every projection
// below goes through toView(), which strips it.

import { err, ok, violation, type Result } from "@fleet/shared";
import type { BackgroundCheckStatus, DriverOnboardingRow } from "@fleet/shared";
import type {
  BackgroundCheckPatch,
  OnboardingAssignmentRow,
  OnboardingProfilePatch,
  OnboardingRepository,
} from "../repositories/onboarding";
import type { DriverRepository } from "../repositories/identity";

/**
 * Client-facing projection of an onboarding record. `ssn_encrypted` is deliberately absent: the
 * ciphertext never leaves the server, and `ssn_on_file` is the only signal the app needs.
 */
export interface OnboardingView {
  id: string;
  driver_id: string;
  full_name: string | null;
  licence_number: string | null;
  licence_class: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  address_json: unknown | null;
  dob: string | null;
  previous_addresses_json: unknown | null;
  ssn_on_file: boolean;
  background_check_status: BackgroundCheckStatus;
  background_check_submitted_at: string | null;
  background_check_cleared_at: string | null;
  consent_given: boolean;
  consent_at: string | null;
  assigned_vehicle_id: string | null;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
}

export interface BackgroundCheckSubmitInput {
  ssn_encrypted?: string | null;
  dob?: string | null;
  previous_addresses_json?: unknown;
  consent_given: boolean;
}

export interface BackgroundCheckResult {
  onboarding_id: string;
  driver_id: string;
  status: BackgroundCheckStatus;
  background_check_submitted_at: string | null;
  consent_given: boolean;
  consent_at: string | null;
}

export function toOnboardingView(row: DriverOnboardingRow): OnboardingView {
  return {
    id: row.id,
    driver_id: row.driver_id,
    full_name: row.full_name,
    licence_number: row.licence_number,
    licence_class: row.licence_class,
    emergency_contact_name: row.emergency_contact_name,
    emergency_contact_phone: row.emergency_contact_phone,
    address_json: row.address_json ?? null,
    dob: row.dob,
    previous_addresses_json: row.previous_addresses_json ?? null,
    ssn_on_file: row.ssn_encrypted != null && row.ssn_encrypted !== "",
    background_check_status: row.background_check_status,
    background_check_submitted_at: row.background_check_submitted_at,
    background_check_cleared_at: row.background_check_cleared_at,
    consent_given: row.consent_given,
    consent_at: row.consent_at,
    assigned_vehicle_id: row.assigned_vehicle_id,
    onboarding_complete: row.onboarding_complete,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class OnboardingService {
  constructor(
    private readonly onboarding: OnboardingRepository,
    private readonly drivers: DriverRepository,
  ) {}

  /**
   * Returns the driver's onboarding record, inserting the initial NOT_SUBMITTED row on first read.
   * The driver app opens the onboarding flow with a GET, so create-on-read keeps the client from
   * needing a separate "start onboarding" call.
   */
  async getOrCreate(driverId: string): Promise<Result<OnboardingView>> {
    const existing = await this.onboarding.getByDriverId(driverId);
    if (existing) return ok(toOnboardingView(existing));
    const created = await this.onboarding.create(driverId);
    return ok(toOnboardingView(created));
  }

  /**
   * Saves the profile step. A partial save is legal, but a body with no recognised field is a
   * client bug rather than a no-op success.
   */
  async saveProfile(driverId: string, input: OnboardingProfilePatch): Promise<Result<OnboardingView>> {
    const provided = (Object.keys(input) as (keyof OnboardingProfilePatch)[]).filter(
      (k) => input[k] !== undefined,
    );
    if (provided.length === 0) {
      return err(
        violation(
          "ONBOARDING_PROFILE_EMPTY",
          "Onboarding profile is empty",
          "Supply at least one profile field to save.",
        ),
      );
    }
    const row = await this.onboarding.upsertProfile(driverId, input);
    return ok(toOnboardingView(row));
  }

  /**
   * Submits the background check. Consent is a hard gate: the screening cannot lawfully run
   * without it (C5.5), so a false `consent_given` is a semantic violation, not a stored row.
   * A record already CLEARED is not re-submitted.
   */
  async submitBackgroundCheck(
    driverId: string,
    input: BackgroundCheckSubmitInput,
  ): Promise<Result<BackgroundCheckResult>> {
    if (!input.consent_given) {
      return err(
        violation(
          "ONBOARDING_CONSENT_REQUIRED",
          "Background check consent required",
          "The driver must consent before a background check can be submitted.",
        ),
      );
    }

    const existing = await this.onboarding.getByDriverId(driverId);
    if (existing && existing.background_check_status === "CLEARED") {
      return err(
        violation(
          "BACKGROUND_CHECK_ALREADY_CLEARED",
          "Background check already cleared",
          "This driver's background check has already been cleared.",
        ),
      );
    }

    const patch: BackgroundCheckPatch = {
      ssn_encrypted: input.ssn_encrypted ?? null,
      dob: input.dob ?? null,
      previous_addresses_json: input.previous_addresses_json,
      consent_given: true,
    };
    const row = await this.onboarding.submitBackgroundCheck(driverId, patch);

    return ok({
      onboarding_id: row.id,
      driver_id: row.driver_id,
      status: row.background_check_status,
      background_check_submitted_at: row.background_check_submitted_at,
      consent_given: row.consent_given,
      consent_at: row.consent_at,
    });
  }

  /** Current dispatch assignment (vehicle + plate), or `{ assignment: null }` when unassigned. */
  async getAssignment(driverId: string): Promise<Result<{ assignment: OnboardingAssignmentRow | null }>> {
    const row = await this.onboarding.getAssignment(driverId);
    return ok({ assignment: row });
  }

  /** Resolves the driver profile behind a user id; used by the `/drivers/me` router surface. */
  async findDriverByUserId(userId: string) {
    return this.drivers.getByUserId(userId);
  }
}
