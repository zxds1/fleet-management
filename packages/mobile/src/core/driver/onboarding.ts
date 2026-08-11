// packages/mobile/src/core/driver/onboarding.ts
//
// Driver onboarding journey (profile setup → background check → vehicle assignment → ready).
// Pure over an injected `ApiClient`, mirroring the other core driver services. Unlike the shift /
// refuel / DVIR journeys there is no evidence upload and no offline outbox: onboarding is a
// one-off, online-only sequence gated on the server (`onboarding:read` / `onboarding:submit`), so a
// transport failure must surface to the screen rather than be replayed later against a driver
// record that may have moved on.
//
// `Idempotency-Key` is attached by `ApiClient.request` for every non-GET/DELETE call (C5.1), so the
// POSTs below simply use `api.send` without threading a key by hand.
//
// The response schemas are *view* schemas local to the mobile client: they describe the shape the
// gateway returns today and are deliberately tolerant (nullable/optional on everything the screens
// can render as "—") so a partially-filled onboarding record never fails the whole screen.

import { z } from "zod"
import type { ApiClient } from "../apiClient"

/** Background-check lifecycle as reported by `GET /drivers/me/onboarding`. */
export const BackgroundCheckStatusSchema = z.enum(["NOT_STARTED", "SUBMITTED", "CLEARED", "FAILED"])
export type BackgroundCheckStatus = z.infer<typeof BackgroundCheckStatusSchema>

/** One row of the previous-address history collected for the background check. */
export const PreviousAddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
})
export type PreviousAddress = z.infer<typeof PreviousAddressSchema>

/** Current residential address stored as `address_json` on the driver record. */
export const OnboardingAddressSchema = z.object({
  street: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
})
export type OnboardingAddress = z.infer<typeof OnboardingAddressSchema>

/**
 * `GET /drivers/me/onboarding`. Tolerant on purpose: before the driver has saved anything the
 * gateway returns nulls for every profile field, and an unknown `background_check_status` must not
 * blank the screen (it falls back to `NOT_STARTED`).
 */
export const OnboardingStateSchema = z.object({
  driver_id: z.string(),
  full_name: z.string().nullable().optional(),
  licence_number: z.string().nullable().optional(),
  licence_class: z.string().nullable().optional(),
  emergency_contact_name: z.string().nullable().optional(),
  emergency_contact_phone: z.string().nullable().optional(),
  address_json: OnboardingAddressSchema.nullable().optional(),
  ssn_on_file: z.boolean().nullable().optional(),
  dob: z.string().nullable().optional(),
  previous_addresses_json: z.array(PreviousAddressSchema.partial()).nullable().optional(),
  background_check_status: z
    .string()
    .nullable()
    .optional()
    .transform((v): BackgroundCheckStatus => {
      const parsed = BackgroundCheckStatusSchema.safeParse(v)
      return parsed.success ? parsed.data : "NOT_STARTED"
    }),
  background_check_submitted_at: z.string().nullable().optional(),
  consent_given: z.boolean().nullable().optional(),
  assigned_vehicle_id: z.string().nullable().optional(),
  onboarding_complete: z.boolean().nullable().optional().transform((v) => v === true),
})
export type OnboardingState = z.infer<typeof OnboardingStateSchema>

/** `GET /drivers/me/assignment` — `null` until dispatch has assigned a vehicle. */
export const VehicleAssignmentSchema = z.object({
  vehicle_id: z.string(),
  vehicle_plate: z.string().nullable().optional(),
  assigned_date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
})
export type VehicleAssignment = z.infer<typeof VehicleAssignmentSchema>

/** Body of `POST /drivers/me/onboarding/profile`. */
export interface ProfileInput {
  full_name: string
  licence_number: string
  licence_class: string
  emergency_contact_name: string
  emergency_contact_phone: string
  address_json: OnboardingAddress
}

/** Body of `POST /drivers/me/background-check`. */
export interface BackgroundCheckInput {
  /** Client-side protected SSN; never logged, never persisted on the device. */
  ssn_encrypted: string
  /** ISO-8601 date (YYYY-MM-DD). */
  dob: string
  previous_addresses_json: PreviousAddress[]
  consent_given: boolean
}

export class OnboardingService {
  constructor(private readonly api: ApiClient) {}

  /** Current onboarding record for the signed-in driver (drives the router's step resolution). */
  async getState(): Promise<OnboardingState> {
    const res = await this.api.request<unknown>("/drivers/me/onboarding", { method: "GET" })
    return OnboardingStateSchema.parse(res)
  }

  /** Step 1 — save the basic profile. Returns the refreshed onboarding state when the gateway
   *  echoes one back, otherwise re-reads it so callers always get a consistent view. */
  async saveProfile(input: ProfileInput): Promise<OnboardingState> {
    const res = await this.api.send<unknown>("POST", "/drivers/me/onboarding/profile", input)
    const parsed = OnboardingStateSchema.safeParse(res)
    return parsed.success ? parsed.data : this.getState()
  }

  /** Step 2 — submit SSN/DOB/address history + consent for the third-party background check. */
  async submitBackgroundCheck(input: BackgroundCheckInput): Promise<OnboardingState> {
    const res = await this.api.send<unknown>("POST", "/drivers/me/background-check", input)
    const parsed = OnboardingStateSchema.safeParse(res)
    return parsed.success ? parsed.data : this.getState()
  }

  /** Step 3 — the vehicle dispatch assigned, or `null` while none exists yet. */
  async getAssignment(): Promise<VehicleAssignment | null> {
    const res = await this.api.request<unknown>("/drivers/me/assignment", { method: "GET" })
    if (res == null) return null
    const parsed = VehicleAssignmentSchema.safeParse(res)
    return parsed.success ? parsed.data : null
  }
}
