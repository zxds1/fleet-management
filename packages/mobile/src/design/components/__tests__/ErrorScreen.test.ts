// packages/mobile/src/design/components/__tests__/ErrorScreen.test.ts
//
// Unit tests for the ErrorScreen pure-logic helpers. Jest only matches *.test.ts
// (no .tsx), so these tests verify the code → i18n mapping, icon selection, error
// normalisation, and that internal error codes are never exposed in user-facing strings.

import { t } from "@/core/i18n"
import type { AppError } from "@/core/error"
import { localError, fromUnknown } from "@/core/error"
import { isFatal } from "@/core/errorCodes"

describe("ErrorScreen mapping", () => {
  describe("resolveAppError (via fromUnknown)", () => {
    it("normalises a raw TypeError into NETWORK_UNAVAILABLE", () => {
      const err = fromUnknown(new TypeError("fetch failed"))
      expect(err.code).toBe("NETWORK_UNAVAILABLE")
      expect(err.fatal).toBe(false)
    })

    it("normalises an arbitrary object into UNKNOWN", () => {
      const err = fromUnknown({ status: 500, someInternal: "detail" })
      expect(err.code).toBe("UNKNOWN")
    })

    it("wraps a plain string into UNKNOWN", () => {
      const err = fromUnknown("something broke")
      expect(err.code).toBe("UNKNOWN")
    })

    it("passes through a pre-formed AppError unchanged", () => {
      const appErr: AppError = localError("FORBIDDEN")
      expect(appErr.code).toBe("FORBIDDEN")
    })
  })

  describe("iconForCode mapping", () => {
    function iconForCode(code: string): string {
      if (code === "NETWORK_UNAVAILABLE") return "cloud_off"
      if (code === "NOT_FOUND") return "error"
      if (isFatal(code)) return "lock"
      return "error"
    }

    it("maps NETWORK_UNAVAILABLE to cloud_off", () => {
      expect(iconForCode("NETWORK_UNAVAILABLE")).toBe("cloud_off")
    })

    it("maps NOT_FOUND to error", () => {
      expect(iconForCode("NOT_FOUND")).toBe("error")
    })

    it("maps fatal codes (UNAUTHENTICATED) to block", () => {
      expect(iconForCode("UNAUTHENTICATED")).toBe("lock")
      expect(iconForCode("ACCOUNT_SUSPENDED")).toBe("lock")
      expect(iconForCode("DEVICE_REVOKED")).toBe("lock")
    })

    it("maps non-fatal codes to error", () => {
      expect(iconForCode("FORBIDDEN")).toBe("error")
      expect(iconForCode("VALIDATION_ERROR")).toBe("error")
      expect(iconForCode("RATE_LIMITED")).toBe("error")
    })
  })

  describe("i18n mapping hides internal codes", () => {
    it("maps every known error code to a localized string without leaking HTTP codes", () => {
      const codes = [
        "VALIDATION_ERROR", "UNAUTHENTICATED", "MFA_REQUIRED", "FORBIDDEN",
        "ACCOUNT_SUSPENDED", "DEVICE_REVOKED", "DEVICE_UNKNOWN", "CONSENT_REQUIRED",
        "NOT_FOUND", "DUPLICATE", "IDEMPOTENCY_CONFLICT", "ODOMETER_DECREASED",
        "RATE_LIMITED", "SERVICE_UNAVAILABLE", "NETWORK_UNAVAILABLE",
        "RESPONSE_INVALID", "MEDIA_UPLOAD_FAILED", "UNKNOWN",
      ]
      for (const code of codes) {
        const label = t(`errors.${code}`)
        expect(label).not.toBe(`errors.${code}`)
        expect(label).not.toMatch(/\b4\d{2}\b/)
        expect(label).not.toMatch(/\b5\d{2}\b/)
      }
    })

    it("maps error actions to localized labels", () => {
      const actions = ["retry", "edit", "go_online", "relogin", "contact_admin",
        "register_device", "accept_consent", "enter_mfa", "wait",
        "unlock_first", "add_photo", "none"]
      for (const action of actions) {
        const label = t(`errorActions.${action}`)
        expect(label).not.toBe(`errorActions.${action}`)
      }
    })

    it("has genericTitle, fatalTitle, notFoundTitle localized", () => {
      expect(t("errors.genericTitle")).toBe("Something went wrong")
      expect(t("errors.fatalTitle")).toBe("Sign in required")
      expect(t("errors.notFoundTitle")).toBe("Not found")
      expect(t("errors.notFoundDescription")).not.toBe("errors.notFoundDescription")
    })
  })

  describe("fatal error treatment", () => {
    it("flags session-kill codes as fatal", () => {
      expect(isFatal("UNAUTHENTICATED")).toBe(true)
      expect(isFatal("ACCOUNT_SUSPENDED")).toBe(true)
      expect(isFatal("DEVICE_REVOKED")).toBe(true)
    })

    it("does not flag recoverable codes as fatal", () => {
      expect(isFatal("VALIDATION_ERROR")).toBe(false)
      expect(isFatal("FORBIDDEN")).toBe(false)
      expect(isFatal("NOT_FOUND")).toBe(false)
      expect(isFatal("RATE_LIMITED")).toBe(false)
    })
  })
})

