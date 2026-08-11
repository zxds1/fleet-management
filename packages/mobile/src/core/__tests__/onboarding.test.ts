// packages/mobile/src/core/__tests__/onboarding.test.ts
//
// Driver onboarding service (C5.1 idempotency, tolerant view schemas) exercised against the shared
// fake network from `testkit`, following the pattern used by `driver.test.ts`.
import { OnboardingService } from "../driver/onboarding"
import { ApiError } from "../apiClient"
import { makeApi, uid, type FakeNetwork } from "./testkit"

const D = uid(1)
const V = uid(2)

const FULL_STATE = {
  driver_id: D,
  full_name: "Jane Doe",
  licence_number: "DL-9931",
  licence_class: "CE",
  emergency_contact_name: "John Doe",
  emergency_contact_phone: "+254700000000",
  address_json: { street: "12 Ngong Rd", city: "Nairobi", state: "Nairobi", zip: "00100" },
  ssn_on_file: true,
  dob: "1990-04-02",
  previous_addresses_json: [{ street: "9 Moi Ave", city: "Mombasa", state: "Mombasa", zip: "80100" }],
  background_check_status: "SUBMITTED",
  background_check_submitted_at: "2026-01-05T09:00:00.000Z",
  consent_given: true,
  assigned_vehicle_id: V,
  onboarding_complete: false,
}

function net(overrides?: Record<string, { status: number; json?: unknown }>): FakeNetwork {
  return {
    calls: [],
    onRequest: (_method, url): { status: number; json?: unknown } => {
      for (const [suffix, res] of Object.entries(overrides ?? {})) {
        if (url.endsWith(suffix)) return res
      }
      if (url.endsWith("/drivers/me/onboarding")) return { status: 200, json: FULL_STATE }
      if (url.endsWith("/drivers/me/onboarding/profile")) return { status: 200, json: FULL_STATE }
      if (url.endsWith("/drivers/me/background-check")) return { status: 200, json: FULL_STATE }
      if (url.endsWith("/drivers/me/assignment")) {
        return { status: 200, json: { vehicle_id: V, vehicle_plate: "KDA 123A", assigned_date: "2026-01-06", status: "ACTIVE" } }
      }
      return { status: 200 }
    },
  }
}

describe("OnboardingService", () => {
  it("parses the onboarding state", async () => {
    const svc = new OnboardingService(makeApi(net()))
    const state = await svc.getState()
    expect(state.full_name).toBe("Jane Doe")
    expect(state.background_check_status).toBe("SUBMITTED")
    expect(state.onboarding_complete).toBe(false)
    expect(state.previous_addresses_json?.[0]?.city).toBe("Mombasa")
  })

  it("defaults an unknown/absent background_check_status to NOT_STARTED", async () => {
    const svc = new OnboardingService(
      makeApi(net({ "/drivers/me/onboarding": { status: 200, json: { driver_id: D, background_check_status: null } } })),
    )
    const state = await svc.getState()
    expect(state.background_check_status).toBe("NOT_STARTED")
    expect(state.onboarding_complete).toBe(false)
  })

  it("POSTs the profile with an Idempotency-Key (C5.1) and returns the refreshed state", async () => {
    const n = net()
    const svc = new OnboardingService(makeApi(n))
    const state = await svc.saveProfile({
      full_name: "Jane Doe",
      licence_number: "DL-9931",
      licence_class: "CE",
      emergency_contact_name: "John Doe",
      emergency_contact_phone: "+254700000000",
      address_json: { street: "12 Ngong Rd", city: "Nairobi", state: "Nairobi", zip: "00100" },
    })
    const post = n.calls?.find((c) => c.url.endsWith("/drivers/me/onboarding/profile"))
    expect(post?.method).toBe("POST")
    expect(post?.body).toMatchObject({ full_name: "Jane Doe", licence_class: "CE" })
    expect(state.driver_id).toBe(D)
  })

  it("POSTs the background check with consent and the address history", async () => {
    const n = net()
    const svc = new OnboardingService(makeApi(n))
    await svc.submitBackgroundCheck({
      ssn_encrypted: "123-45-6789",
      dob: "1990-04-02",
      previous_addresses_json: [{ street: "9 Moi Ave", city: "Mombasa", state: "Mombasa", zip: "80100" }],
      consent_given: true,
    })
    const post = n.calls?.find((c) => c.url.endsWith("/drivers/me/background-check"))
    expect(post?.method).toBe("POST")
    expect(post?.body).toMatchObject({ dob: "1990-04-02", consent_given: true })
  })

  it("re-reads the state when a POST returns a non-state body", async () => {
    const n = net({ "/drivers/me/onboarding/profile": { status: 200, json: { ok: true } } })
    const svc = new OnboardingService(makeApi(n))
    const state = await svc.saveProfile({
      full_name: "Jane Doe",
      licence_number: "DL-9931",
      licence_class: "CE",
      emergency_contact_name: "John Doe",
      emergency_contact_phone: "+254700000000",
      address_json: {},
    })
    expect(state.driver_id).toBe(D)
    expect(n.calls?.filter((c) => c.url.endsWith("/drivers/me/onboarding")).length).toBe(1)
  })

  it("parses the vehicle assignment and maps an absent one to null", async () => {
    const svc = new OnboardingService(makeApi(net()))
    await expect(svc.getAssignment()).resolves.toMatchObject({ vehicle_plate: "KDA 123A", status: "ACTIVE" })

    const none = new OnboardingService(makeApi(net({ "/drivers/me/assignment": { status: 200, json: null } })))
    await expect(none.getAssignment()).resolves.toBeNull()
  })

  it("surfaces a domain error as ApiError", async () => {
    const svc = new OnboardingService(
      makeApi(net({ "/drivers/me/background-check": { status: 422, json: { error_code: "VALIDATION_ERROR", message: "x" } } })),
    )
    await expect(
      svc.submitBackgroundCheck({ ssn_encrypted: "x", dob: "1990-04-02", previous_addresses_json: [], consent_given: true }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
