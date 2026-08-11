// packages/mobile/src/core/__tests__/errorCodes.test.ts
import {
  toKnownErrorCode,
  specFor,
  dispositionFor,
  isFatal,
  ERROR_CODES,
} from "../errorCodes";

describe("errorCodes", () => {
  it("maps known codes into the catalogue", () => {
    expect(toKnownErrorCode("UNAUTHENTICATED")).toBe("UNAUTHENTICATED");
    expect(toKnownErrorCode("NOT_A_CODE")).toBe("UNKNOWN");
    expect(toKnownErrorCode(undefined)).toBe("UNKNOWN");
  });

  it("derives the correct offline disposition per D-7", () => {
    expect(dispositionFor("DUPLICATE")).toBe("discard");
    expect(dispositionFor("IDEMPOTENCY_CONFLICT")).toBe("discard");
    expect(dispositionFor("ODOMETER_DECREASED")).toBe("failed_review");
    expect(dispositionFor("RATE_LIMITED")).toBe("retry");
    expect(dispositionFor("UNAUTHENTICATED")).toBe("reauth");
  });

  it("flags fatal session codes", () => {
    expect(isFatal("ACCOUNT_SUSPENDED")).toBe(true);
    expect(isFatal("DEVICE_REVOKED")).toBe(true);
    expect(isFatal("VALIDATION_ERROR")).toBe(false);
  });

  it("every code has a spec and an action", () => {
    for (const code of ERROR_CODES) {
      const spec = specFor(code);
      expect(spec.messageKey).toBe(code);
      expect(spec.action).toBeTruthy();
    }
  });
});
