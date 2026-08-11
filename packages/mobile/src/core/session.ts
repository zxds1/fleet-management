// packages/mobile/src/core/session.ts
//
// Session domain logic. Pure over injected ports so it is unit-testable in node (the auth vertical
// slice wires the real expo-secure-store / biometric ports in screens). Responsibilities
// (docs/backend/02-auth.md + docs/apps/auth flow):
//   • Login (+ optional MFA second leg) → build a `Principal` from the validated response.
//   • Refresh, logout.
//   • Device register (for push delivery). The account is not device-bound, so any phone may sign in.
//   • Consent (C5.5): GPS tracking consent version is recorded with the server.
//   • Biometric unlock (injected) re-establishes the in-memory session from the secure store.
//   • Persist the refresh token + principal in a secure store (never in logs, C5.3).
//   • Keep `locale` in sync with `i18n.setLocale` (D-10), sourced from the principal.

import type { Principal } from "@fleet/shared/mobile"
import { ApiClient, ApiError } from "./apiClient"
import { localError } from "./error"
import { setLocale, type Locale } from "./i18n"
import {
  LoginRequest,
  LoginRequestSchema,
  LoginResponse,
  toPrincipal,
  DeviceRegisterRequest,
  DeviceRegisterRequestSchema,
  DeviceRegisterResponseSchema,
  ConsentRequest,
  ConsentRequestSchema,
  ConsentResponseSchema,
  AdminSignupRequest,
  AdminSignupRequestSchema,
  AdminSignupResponse,
  AdminSignupResponseSchema,
} from "./auth/schemas"

export interface SecureStorePort {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Optional biometric unlock (expo-local-authentication). */
export interface BiometricPort {
  isAvailable(): Promise<boolean>
  authenticate(reason: string): Promise<boolean>
  /** Returns the stored credential (e.g. the access token) if a biometric binding exists. */
  getStoredToken(): Promise<string | undefined>
}

export interface SessionState {
  accessToken?: string
  refreshToken?: string
  principal?: Principal
  deviceIdHash?: string
  consentVersion?: string
}

const ACCESS_KEY = "session.accessToken"
const REFRESH_KEY = "session.refreshToken"
const PRINCIPAL_KEY = "session.principal"
const DEVICE_KEY = "session.deviceIdHash"
const CONSENT_KEY = "session.consentVersion"

/** Permissions are serialized as an array (a Set does not survive JSON). */
function serializePrincipal(p: Principal): string {
  return JSON.stringify({ ...p, permissions: [...p.permissions] })
}
function deserializePrincipal(raw: string | undefined): Principal | undefined {
  if (!raw) return undefined
  try {
    const obj = JSON.parse(raw) as Principal & { permissions: string[] }
    return { ...obj, permissions: new Set(obj.permissions) as Principal["permissions"] }
  } catch {
    return undefined
  }
}

export class Session {
  private state: SessionState = {}
  private biometric?: BiometricPort

  constructor(
    private readonly api: ApiClient,
    private readonly store: SecureStorePort,
    opts?: { biometric?: BiometricPort },
  ) {
    this.biometric = opts?.biometric
  }

  async restore(): Promise<SessionState> {
    const [access, refresh, principalRaw, deviceRaw, consentRaw] = await Promise.all([
      this.store.get(ACCESS_KEY),
      this.store.get(REFRESH_KEY),
      this.store.get(PRINCIPAL_KEY),
      this.store.get(DEVICE_KEY),
      this.store.get(CONSENT_KEY),
    ])
    this.state = {
      accessToken: access,
      refreshToken: refresh,
      principal: deserializePrincipal(principalRaw),
      deviceIdHash: deviceRaw,
      consentVersion: consentRaw,
    }
    if (this.state.principal?.locale) setLocale(this.state.principal.locale as Locale)
    return this.state
  }

  getState(): SessionState {
    return this.state
  }
  get token(): string | undefined {
    return this.state.accessToken
  }
  get principal(): Principal | undefined {
    return this.state.principal
  }
  get deviceIdHash(): string | undefined {
    return this.state.deviceIdHash
  }
  hasRole(role: string): boolean {
    return !!this.state.principal?.roles.includes(role as Principal["roles"][number])
  }
  hasPermission(perm: string): boolean {
    return !!this.state.principal?.permissions.has(perm as Parameters<Principal["permissions"]["has"]>[0])
  }
  isAuthed(): boolean {
    return !!this.state.accessToken && !!this.state.principal
  }

  // --- Login (+ MFA second leg) ----------------------------------------------------------

  /** First leg (no MFA code) or second leg (with code). On 401 MFA_REQUIRED the caller shows MFA. */
  async login(req: LoginRequest): Promise<Principal> {
    const body = LoginRequestSchema.parse(req)
    const res = await this.api.request<LoginResponse>("/auth/login", {
      method: "POST",
      body,
      anonymous: true,
    })
    const principal = toPrincipal(res)
    if (res.mfa_required && !body.mfa_code) {
      throw new MfaRequiredError(principal)
    }
    await this.applyAuth(res.access_token, res.refresh_token, principal)
    return principal
  }

  /** Exchange a one-time recovery code for a bypass token, then complete login. */
  async loginWithRecoveryCode(email: string, password: string, recoveryCode: string): Promise<Principal> {
    const bypass = await this.api.request<{ bypass_token: string }>("/auth/mfa/recover", {
      method: "POST",
      body: { email, password, recovery_code: recoveryCode },
      anonymous: true,
    })
    return this.login({ email, password, mfa_code: bypass.bypass_token })
  }

  /**
   * Self-service admin account creation *with company provisioning* (A3.7). Binds to
   * `POST /auth/signup`, which creates the account and its company (tenant) in one call. The server
   * enforces email-uniqueness and the password-strength policy; on success the account is ACTIVE and
   * granted ADMIN (which requires MFA on first login). No device/PIN needed here — login afterwards.
   *
   * There is deliberately NO fallback to an account-only signup endpoint. Company creation cannot be
   * fulfilled by one, so retrying there would risk provisioning an ADMIN with no tenant while
   * consuming the email address — a state the user cannot recover from by signing up again. Any
   * failure (including a transient 5xx during a deploy) surfaces to the caller so the user can retry
   * the whole operation safely.
   */
  async signupAdmin(req: AdminSignupRequest): Promise<AdminSignupResponse> {
    const body = AdminSignupRequestSchema.parse(req)
    const res = await this.api.request<unknown>("/auth/signup", {
      method: "POST",
      body,
      anonymous: true,
    })
    // A 2xx that does not carry the created account is not a success we can act on; fail loudly
    // rather than pretending the company was provisioned.
    const parsed = AdminSignupResponseSchema.safeParse(res)
    if (!parsed.success) throw new ApiError(localError("RESPONSE_INVALID"))
    return parsed.data
  }

  // --- Refresh / logout ----------------------------------------------------------------

  async refresh(): Promise<Principal | undefined> {
    if (!this.state.refreshToken) return undefined
    const res = await this.api.request<LoginResponse>("/auth/refresh", {
      method: "POST",
      body: { refresh_token: this.state.refreshToken },
      anonymous: true,
    })
    const principal = toPrincipal(res)
    await this.applyAuth(res.access_token, res.refresh_token, principal)
    return principal
  }

  async logout(): Promise<void> {
    try {
      if (this.state.accessToken) {
        await this.api.request("/auth/logout", { method: "POST", anonymous: false })
      }
    } catch {
      /* best-effort */
    }
    this.state = {}
    await Promise.all([
      this.store.delete(ACCESS_KEY),
      this.store.delete(REFRESH_KEY),
      this.store.delete(PRINCIPAL_KEY),
      this.store.delete(DEVICE_KEY),
      this.store.delete(CONSENT_KEY),
    ])
  }

  // --- Device (push delivery, not used for authz) ----------------------------------------

  async registerDevice(req: DeviceRegisterRequest): Promise<string> {
    const body = DeviceRegisterRequestSchema.parse(req)
    const res = await this.api.request<unknown>("/auth/devices", {
      method: "POST",
      body,
    })
    const deviceId = DeviceRegisterResponseSchema.parse(res).device_id
    this.state = { ...this.state, deviceIdHash: body.device_id_hash }
    await this.store.set(DEVICE_KEY, body.device_id_hash)
    return deviceId
  }

  // --- Consent (C5.5) -------------------------------------------------------------------

  async acceptConsent(version: string): Promise<void> {
    const body = ConsentRequestSchema.parse({
      consent_type: "GPS_TRACKING_WORKING_HOURS",
      policy_version: version,
      accepted: true,
    })
    const res = await this.api.request<unknown>("/auth/consent", {
      method: "POST",
      body,
    })
    const verified = ConsentResponseSchema.parse(res)
    if (!verified.accepted) return
    this.state = { ...this.state, consentVersion: version }
    await this.store.set(CONSENT_KEY, version)
  }

  hasConsent(version: string): boolean {
    return this.state.consentVersion === version
  }

  // --- Biometric unlock -----------------------------------------------------------------

  async biometricUnlock(reason: string): Promise<boolean> {
    if (!this.biometric) return false
    const available = await this.biometric.isAvailable()
    if (!available) return false
    const okAuth = await this.biometric.authenticate(reason)
    if (!okAuth) return false
    const token = await this.biometric.getStoredToken()
    if (!token) return false
    this.state = { ...this.state, accessToken: token }
    return true
  }

  // --- internals ------------------------------------------------------------------------

  private async applyAuth(accessToken: string, refreshToken: string, principal: Principal): Promise<void> {
    this.state = { ...this.state, accessToken, refreshToken, principal }
    await Promise.all([
      this.store.set(ACCESS_KEY, accessToken),
      this.store.set(REFRESH_KEY, refreshToken),
      this.store.set(PRINCIPAL_KEY, serializePrincipal(principal)),
    ])
    if (principal.locale) setLocale(principal.locale as Locale)
  }
}

export class MfaRequiredError extends Error {
  constructor(public readonly principal: Principal) {
    super("MFA_REQUIRED")
    this.name = "MfaRequiredError"
  }
}
