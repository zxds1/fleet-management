// packages/mobile/src/core/__tests__/flow.test.ts
import { AuthFlow } from "../auth/flow"
import { Session, type SecureStorePort } from "../session"
import { ApiClient } from "../apiClient"

function memStore(initial: Record<string, string> = {}): SecureStorePort {
  const m = new Map(Object.entries(initial))
  return {
    async get(k) {
      return m.get(k)
    },
    async set(k, v) {
      m.set(k, v)
    },
    async delete(k) {
      m.delete(k)
    },
  }
}

/** Fake backend: /auth/login returns a principal; supports a second MFA leg. */
function makeApi(mfaEnrolled: boolean, roles: string[] = ["DRIVER"]) {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString()
    const body = init?.body ? JSON.parse(init.body as string) : {}
    if (url.endsWith("/auth/login")) {
      if (mfaEnrolled && !body.mfa_code) {
        return new Response(JSON.stringify({ error_code: "MFA_REQUIRED", message: "mfa" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response(
        JSON.stringify({
          access_token: "a",
          refresh_token: "r",
          user_id: "u1",
          email: body.email ?? "d@f.co.ke",
          roles,
          permissions: ["SHIFT_CREATE"],
          locale: "en",
          session_id: "s1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    if (url.includes("/auth/devices")) {
      return new Response(JSON.stringify({ device_id: "dev_1", push_token: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url.endsWith("/auth/consent")) {
      return new Response(JSON.stringify({ consent_id: "c_1", accepted: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url.endsWith("/auth/signup")) {
      if (body.email === "taken@f.co.ke") {
        return new Response(
          JSON.stringify({
            error_code: "VALIDATION_ERROR",
            title: "Validation failed",
            detail: "Email already registered",
            field_errors: [{ field: "email", code: "EMAIL_TAKEN", message: "An account with this email already exists." }],
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        )
      }
      return new Response(
        JSON.stringify({ user_id: "u_new", email: body.email, company_id: "c_new", company_name: body.company_name, role: "ADMIN" }),
        { status: 201, headers: { "content-type": "application/json" } },
      )
    }
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
  return new ApiClient({ baseUrl: "https://x/api/v1", fetchImpl, getToken: () => undefined })
}

describe("AuthFlow", () => {
  it("driver login goes login → consent → authed (role on login screen, no PIN step)", async () => {
    const api = makeApi(false)
    const session = new Session(api, memStore())
    const flow = new AuthFlow(session, { consentVersion: "2026.1" })
    expect(await flow.begin()).toBe("login")

    let step = await flow.submitLogin("+254712345678", "pw", "driver")
    expect(step).toBe("consent")

    step = await flow.acceptConsent()
    expect(step).toBe("authed")
  })

  it("MFA-enrolled user is routed to the MFA screen", async () => {
    const api = makeApi(true)
    const session = new Session(api, memStore())
    const flow = new AuthFlow(session, { consentVersion: "2026.1" })
    const step = await flow.submitLogin("a@f.co.ke", "pw", "admin")
    expect(step).toBe("mfa")
    expect(flow.step).toBe("mfa")
  })

  it("a 401 MFA_REQUIRED surfaces as MfaRequiredError branch", async () => {
    const api = makeApi(true)
    const session = new Session(api, memStore())
    const flow = new AuthFlow(session, { consentVersion: "2026.1" })
    expect(await flow.submitLogin("a@f.co.ke", "pw", "admin")).toBe("mfa")
    expect(flow.error).toBeUndefined()
  })

  it("admin self-signup creates the company + account then continues into login", async () => {
    const api = makeApi(false)
    const session = new Session(api, memStore())
    const flow = new AuthFlow(session, { consentVersion: "2026.1" })
    expect(flow.goToSignup()).toBe("signup")
    // Successful signup auto-continues into the login leg (DemoApi returns a DRIVER principal, so the
    // new admin would next hit PIN/consent; the assertion is that we leave the signup step).
    const step = await flow.submitSignup({
      email: "new@f.co.ke",
      password: "Trucking!2026Safe",
      companyName: "Acme Logistics",
      fullName: "Asha Maina",
    })
    expect(step).not.toBe("signup")
    expect(flow.error).toBeUndefined()
  })

  it("signup surfaces a duplicate-email error and stays on the signup step", async () => {
    const api = makeApi(false)
    const session = new Session(api, memStore())
    const flow = new AuthFlow(session, { consentVersion: "2026.1" })
    const step = await flow.submitSignup({
      email: "taken@f.co.ke",
      password: "Trucking!2026Safe",
      companyName: "Acme Logistics",
      fullName: "Dup",
    })
    expect(step).toBe("signup")
    expect(flow.error?.code).toBe("VALIDATION_ERROR")
    expect(flow.error?.fields?.email).toBeDefined()
  })

  it("never falls back to a second endpoint when signup fails, so no company-less admin is created", async () => {
    // A transient 5xx must surface, not silently retry against an account-only endpoint: that would
    // consume the email address while provisioning an ADMIN with no tenant.
    const paths: string[] = []
    const fetchImpl = (async (url: string) => {
      paths.push(new URL(url).pathname)
      return new Response(null, { status: 503 })
    }) as unknown as typeof fetch
    const api = new ApiClient({ baseUrl: "https://x/api/v1", fetchImpl, getToken: () => undefined })
    const flow = new AuthFlow(new Session(api, memStore()), { consentVersion: "2026.1" })

    const step = await flow.submitSignup({
      email: "new@f.co.ke",
      password: "Trucking!2026Safe",
      companyName: "Acme Logistics",
    })

    expect(step).toBe("signup")
    expect(flow.error).toBeDefined()
    expect(paths).toEqual(["/api/v1/auth/signup"])
  })
})
