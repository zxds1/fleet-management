// packages/api/test/onboarding.service.test.ts
// Unit tests for OnboardingService (driver onboarding + background check). No DB: the repositories
// are hand-rolled fakes double-cast through `unknown`, matching the convention in
// inspections.service.test.ts. Assertions are on `result.ok` and `result.error.error_code` — never
// on the message, because error_code is the only client-branchable member (08 §1).

import type { DriverOnboardingRow, DriverRow } from "@fleet/shared";
import { OnboardingService, toOnboardingView } from "../src/services/onboarding";
import type { OnboardingAssignmentRow } from "../src/repositories/onboarding";

type OnboardingRepo = import("../src/repositories/onboarding").OnboardingRepository;
type DriverRepo = import("../src/repositories/identity").DriverRepository;

const DRIVER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function makeRow(overrides: Partial<DriverOnboardingRow> = {}): DriverOnboardingRow {
  return {
    id: "onb-1",
    driver_id: DRIVER_ID,
    full_name: null,
    licence_number: null,
    licence_class: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    address_json: null,
    ssn_encrypted: null,
    dob: null,
    previous_addresses_json: null,
    background_check_status: "NOT_SUBMITTED",
    background_check_submitted_at: null,
    background_check_cleared_at: null,
    consent_given: false,
    consent_at: null,
    assigned_vehicle_id: null,
    onboarding_complete: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

interface Calls {
  created: string[];
  profiles: unknown[];
  submissions: unknown[];
}

function makeService(
  overrides: {
    existing?: DriverOnboardingRow | null;
    assignment?: OnboardingAssignmentRow | null;
    driver?: DriverRow | null;
  } = {},
) {
  const calls: Calls = { created: [], profiles: [], submissions: [] };

  const onboarding = {
    getByDriverId: async () => overrides.existing ?? null,
    create: async (driverId: string) => {
      calls.created.push(driverId);
      return makeRow({ driver_id: driverId });
    },
    upsertProfile: async (driverId: string, patch: Record<string, unknown>) => {
      calls.profiles.push({ driverId, patch });
      return makeRow({ ...(patch as Partial<DriverOnboardingRow>), driver_id: driverId });
    },
    submitBackgroundCheck: async (driverId: string, patch: Record<string, unknown>) => {
      calls.submissions.push({ driverId, patch });
      return makeRow({
        driver_id: driverId,
        ssn_encrypted: (patch.ssn_encrypted as string | null) ?? null,
        background_check_status: "SUBMITTED",
        background_check_submitted_at: "2026-08-09T10:00:00Z",
        consent_given: true,
        consent_at: "2026-08-09T10:00:00Z",
      });
    },
    getAssignment: async () => overrides.assignment ?? null,
  } as unknown as OnboardingRepo;

  const drivers = {
    getByUserId: async () => overrides.driver ?? null,
    findByUserId: async () => overrides.driver ?? null,
  } as unknown as DriverRepo;

  return { service: new OnboardingService(onboarding, drivers), calls };
}

describe("OnboardingService.getOrCreate", () => {
  it("creates a NOT_SUBMITTED record on first read", async () => {
    const { service, calls } = makeService({ existing: null });
    const result = await service.getOrCreate(DRIVER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.background_check_status).toBe("NOT_SUBMITTED");
      expect(result.value.driver_id).toBe(DRIVER_ID);
    }
    expect(calls.created).toEqual([DRIVER_ID]);
  });

  it("returns the existing record without inserting a second one", async () => {
    const existing = makeRow({ background_check_status: "CLEARED", full_name: "Jane Wanjiru" });
    const { service, calls } = makeService({ existing });
    const result = await service.getOrCreate(DRIVER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.full_name).toBe("Jane Wanjiru");
    expect(calls.created).toEqual([]);
  });

  it("never exposes the SSN ciphertext, only whether one is on file", async () => {
    const existing = makeRow({ ssn_encrypted: "ciphertext-abc" });
    const { service } = makeService({ existing });
    const result = await service.getOrCreate(DRIVER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ssn_on_file).toBe(true);
      expect(JSON.stringify(result.value)).not.toContain("ciphertext-abc");
    }
  });
});

describe("OnboardingService.saveProfile", () => {
  it("saves a partial profile", async () => {
    const { service, calls } = makeService();
    const result = await service.saveProfile(DRIVER_ID, { full_name: "Jane Wanjiru" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.full_name).toBe("Jane Wanjiru");
    expect(calls.profiles).toHaveLength(1);
  });

  it("rejects an empty profile body with ONBOARDING_PROFILE_EMPTY", async () => {
    const { service, calls } = makeService();
    const result = await service.saveProfile(DRIVER_ID, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("ONBOARDING_PROFILE_EMPTY");
    expect(calls.profiles).toEqual([]);
  });

  it("treats a body of only undefined values as empty", async () => {
    const { service } = makeService();
    const result = await service.saveProfile(DRIVER_ID, { full_name: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("ONBOARDING_PROFILE_EMPTY");
  });
});

describe("OnboardingService.submitBackgroundCheck", () => {
  it("stores the ciphertext and returns status SUBMITTED", async () => {
    const { service, calls } = makeService({ existing: makeRow() });
    const result = await service.submitBackgroundCheck(DRIVER_ID, {
      ssn_encrypted: "ciphertext-abc",
      dob: "1990-05-14",
      previous_addresses_json: [{ line1: "12 Ngong Rd", city: "Nairobi" }],
      consent_given: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("SUBMITTED");
      expect(result.value.consent_given).toBe(true);
      expect(result.value.background_check_submitted_at).toBe("2026-08-09T10:00:00Z");
    }
    expect(calls.submissions).toHaveLength(1);
  });

  it("rejects a submission without consent with ONBOARDING_CONSENT_REQUIRED", async () => {
    const { service, calls } = makeService();
    const result = await service.submitBackgroundCheck(DRIVER_ID, {
      ssn_encrypted: "ciphertext-abc",
      consent_given: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("ONBOARDING_CONSENT_REQUIRED");
    expect(calls.submissions).toEqual([]);
  });

  it("rejects re-submission once cleared with BACKGROUND_CHECK_ALREADY_CLEARED", async () => {
    const existing = makeRow({ background_check_status: "CLEARED" });
    const { service, calls } = makeService({ existing });
    const result = await service.submitBackgroundCheck(DRIVER_ID, { consent_given: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("BACKGROUND_CHECK_ALREADY_CLEARED");
    expect(calls.submissions).toEqual([]);
  });

  it("allows re-submission after a FLAGGED result", async () => {
    const existing = makeRow({ background_check_status: "FLAGGED" });
    const { service } = makeService({ existing });
    const result = await service.submitBackgroundCheck(DRIVER_ID, { consent_given: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("SUBMITTED");
  });

  it("submits when no record exists yet (upsert path)", async () => {
    const { service } = makeService({ existing: null });
    const result = await service.submitBackgroundCheck(DRIVER_ID, { consent_given: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("SUBMITTED");
  });
});

describe("OnboardingService.getAssignment", () => {
  it("returns the latest assignment with the vehicle plate", async () => {
    const assignment: OnboardingAssignmentRow = {
      assignment_id: "asg-1",
      assigned_date: "2026-08-09",
      status: "ACTIVE",
      vehicle_id: "veh-1",
      vehicle_plate: "KDA 123A",
      trailer_id: null,
    };
    const { service } = makeService({ assignment });
    const result = await service.getAssignment(DRIVER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assignment?.vehicle_plate).toBe("KDA 123A");
  });

  it("returns a null assignment when the driver has never been dispatched", async () => {
    const { service } = makeService({ assignment: null });
    const result = await service.getAssignment(DRIVER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assignment).toBeNull();
  });
});

describe("OnboardingService.findDriverByUserId", () => {
  it("returns null when the user has no driver profile", async () => {
    const { service } = makeService({ driver: null });
    await expect(service.findDriverByUserId(USER_ID)).resolves.toBeNull();
  });

  it("returns the driver profile when one exists", async () => {
    const driver = { id: DRIVER_ID, user_id: USER_ID } as DriverRow;
    const { service } = makeService({ driver });
    await expect(service.findDriverByUserId(USER_ID)).resolves.toBe(driver);
  });
});

describe("toOnboardingView", () => {
  it("reports ssn_on_file as false for an empty ciphertext", () => {
    expect(toOnboardingView(makeRow({ ssn_encrypted: "" })).ssn_on_file).toBe(false);
    expect(toOnboardingView(makeRow({ ssn_encrypted: null })).ssn_on_file).toBe(false);
  });
});
