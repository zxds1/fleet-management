// packages/mobile/src/core/__tests__/i18n.test.ts
import { t, setLocale, getLocale } from "../i18n";

describe("i18n", () => {
  afterEach(() => setLocale("en"));

  it("falls back to english for missing sw keys but never crashes", () => {
    setLocale("sw");
    expect(t("auth.logIn")).toBe("Ingia");
    expect(getLocale()).toBe("sw");
  });

  it("interpolates placeholders", () => {
    expect(t("auth.pinAttemptsRemaining", { count: 3 })).toContain("3");
  });

  it("returns the key when no translation exists", () => {
    expect(t("totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("maps error codes to localized copy", () => {
    expect(t("errors.DUPLICATE")).toContain("already");
    setLocale("sw");
    expect(t("errors.DUPLICATE")).toContain("rekodiwa");
  });
});
