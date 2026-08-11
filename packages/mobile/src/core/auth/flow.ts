// packages/mobile/src/core/auth/flow.ts
//
// Pure auth vertical-slice orchestration (docs/apps flows.md + 02-auth.md). Drives the screen
// sequence without any React/native dependency so it is unit-testable with a fake `Session`.
//
//   login → (mfa) → consent (if not granted) → authed
//
// The role (driver/admin) is chosen on the login screen itself — drivers sign in with their phone
// number, admins with email — so the account is authenticated as the role it already is, with no
// separate post-login role picker. The offline PIN has been removed.
// (account is not device-bound). The `Session` owns all network + secure-store side effects; this
// class only decides the *next screen* from the result (including the MFA_REQUIRED branch and
// consent gating, C5.5).

import type { Principal } from "@fleet/shared/mobile"
import { Session, MfaRequiredError } from "../session"
import { ApiError } from "../apiClient"
import type { AppError } from "../error"
import { localError } from "../error"

export type AuthStep = "login" | "signup" | "mfa" | "consent" | "authed"
export type Role = "driver" | "admin"

export interface AuthFlowConfig {
  /** GPS consent policy version the app requires (C5.5). */
  consentVersion: string
}

export class AuthFlow {
  step: AuthStep = "login"
  error: AppError | undefined
  pendingPrincipal: Principal | undefined
  /** Credentials captured on the first login leg, replayed on the MFA second leg. */
  private pendingCredentials: { identifier: string; password: string } | undefined
  submitting = false

  constructor(private readonly session: Session, readonly config: AuthFlowConfig) {}

  /** Resolve the starting step from the restored session. */
  async begin(): Promise<AuthStep> {
    if (this.session.isAuthed()) {
      this.step = "authed"
    } else {
      this.step = "login"
    }
    return this.step
  }

  /** Drivers sign in with a phone number (E.164); everyone else with email. */
  private loginBody(identifier: string, password: string, mfaCode?: string) {
    const isPhone = /^\+?[1-9]\d{6,14}$/.test(identifier.trim())
    return isPhone
      ? { phone: identifier.trim(), password, mfa_code: mfaCode }
      : { email: identifier.trim(), password, mfa_code: mfaCode }
  }

  private afterLogin(p: Principal): AuthStep {
    this.pendingPrincipal = p
    if (!this.session.hasConsent(this.config.consentVersion)) return (this.step = "consent")
    return (this.step = "authed")
  }

  async submitLogin(identifier: string, password: string, _role: Role): Promise<AuthStep> {
    this.submitting = true
    this.error = undefined
    this.pendingCredentials = { identifier, password }
    try {
      const p = await this.session.login(this.loginBody(identifier, password))
      return this.afterLogin(p)
    } catch (e) {
      if (e instanceof MfaRequiredError || this.isMfaRequired(e)) {
        return (this.step = "mfa")
      }
      this.error = (e as { appError?: AppError }).appError ?? this.toAppError(e)
      return (this.step = "login")
    } finally {
      this.submitting = false
    }
  }

  /** Navigate to the admin self-signup screen. */
  goToSignup(): AuthStep {
    this.error = undefined
    return (this.step = "signup")
  }

  /** Return from signup to the login screen. */
  goToLogin(): AuthStep {
    this.error = undefined
    return (this.step = "login")
  }

  /**
   * Create an admin account *and its company*, then continue straight into the login flow with the
   * same credentials so the server's MFA gate (ADMIN requires_mfa) is honoured. On signup failure
   * the error is surfaced and we stay on the signup step.
   *
   * `companyName` is required — this endpoint provisions the tenant, and a blank one would create an
   * admin with no company. `fullName` is optional; the server derives it from the email local-part.
   */
  async submitSignup(input: {
    email: string
    password: string
    companyName: string
    fullName?: string
    phone?: string
  }): Promise<AuthStep> {
    this.submitting = true
    this.error = undefined
    try {
      await this.session.signupAdmin({
        email: input.email,
        password: input.password,
        company_name: input.companyName.trim(),
        full_name: input.fullName?.trim() || undefined,
        phone: input.phone,
      })
      // Continue into login (carries the credentials so the MFA second leg can replay them).
      return this.submitLogin(input.email, input.password, "admin")
    } catch (e) {
      this.error = (e as { appError?: AppError }).appError ?? this.toAppError(e)
      return (this.step = "signup")
    } finally {
      this.submitting = false
    }
  }

  private isMfaRequired(e: unknown): boolean {
    return e instanceof ApiError && e.appError.code === "MFA_REQUIRED"
  }

  async submitMfa(code: string): Promise<AuthStep> {
    const creds = this.pendingCredentials
    if (!creds) {
      // The first login leg is what captures the credentials the second leg replays; without them
      // the MFA screen is a dead end, so send the user back to re-enter them.
      this.error = localError("UNAUTHENTICATED")
      return (this.step = "login")
    }
    this.submitting = true
    this.error = undefined
    try {
      const p = await this.session.login(this.loginBody(creds.identifier, creds.password, code))
      return this.afterLogin(p)
    } catch (e) {
      if (this.isMfaRequired(e)) return (this.step = "mfa")
      this.error = (e as { appError?: AppError }).appError ?? this.toAppError(e)
      return (this.step = "mfa")
    } finally {
      this.submitting = false
    }
  }

  async acceptConsent(): Promise<AuthStep> {
    this.submitting = true
    this.error = undefined
    try {
      await this.session.acceptConsent(this.config.consentVersion)
      return (this.step = "authed")
    } catch (e) {
      this.error = (e as { appError?: AppError }).appError ?? this.toAppError(e)
      return (this.step = "consent")
    } finally {
      this.submitting = false
    }
  }

  declineConsent(): AuthStep {
    // Consent is mandatory to start a shift; the user cannot proceed without it.
    return (this.step = "consent")
  }

  private toAppError(e: unknown): AppError {
    return { code: "UNKNOWN", message: e instanceof Error ? e.message : String(e), fatal: false, action: "retry", disposition: "failed_review" }
  }
}
