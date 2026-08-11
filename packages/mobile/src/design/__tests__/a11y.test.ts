// packages/mobile/src/design/__tests__/a11y.test.ts
import { clampFontSizeMultiplier, scaledFontSize, nextLargeTextTier, LARGE_TEXT_TIERS } from "../a11y";

describe("a11y — large-text scaling", () => {
  it("clamps an OS multiplier to the 1.6x budget", () => {
    expect(clampFontSizeMultiplier(2.5)).toBe(1.6);
    expect(clampFontSizeMultiplier(1.3)).toBe(1.3);
    expect(clampFontSizeMultiplier(1)).toBe(1);
  });

  it("treats non-finite / non-positive multipliers as 1x", () => {
    expect(clampFontSizeMultiplier(NaN)).toBe(1);
    expect(clampFontSizeMultiplier(0)).toBe(1);
    expect(clampFontSizeMultiplier(-3)).toBe(1);
  });

  it("scales a base font size by the clamped multiplier", () => {
    expect(scaledFontSize(14, 1)).toBe(14);
    expect(scaledFontSize(14, 2.5)).toBe(22.4); // 14 * 1.6
  });

  it("cycles through the large-text tiers for a settings toggle", () => {
    expect(nextLargeTextTier(1)).toBe(1.3);
    expect(nextLargeTextTier(1.3)).toBe(1.6);
    expect(nextLargeTextTier(1.6)).toBe(LARGE_TEXT_TIERS[0]);
  });
});
