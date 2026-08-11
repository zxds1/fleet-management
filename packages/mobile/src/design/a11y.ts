// packages/mobile/src/design/a11y.ts
//
// Accessibility helpers (IMPLEMENTATION-PROMPT §5.9 "a11y + large-text"). The design tokens cap OS font
// scaling at 1.6x (tokens.ts `a11y.maxFontSizeMultiplier`) so 200% text does not break the data-dense
// admin tables. This module turns an OS multiplier into a safe, clamped scale and exposes a helper that
// applies it to any numeric font size. All logic is pure + unit-tested.

import { a11y } from "./tokens"

/** Clamp an OS font-scale multiplier to the app's accessibility budget. */
export function clampFontSizeMultiplier(osMultiplier: number): number {
  if (!Number.isFinite(osMultiplier) || osMultiplier <= 0) return 1
  return Math.min(osMultiplier, a11y.maxFontSizeMultiplier)
}

/** Apply the clamped multiplier to a base font size, returning the rendered size in px. */
export function scaledFontSize(base: number, osMultiplier: number): number {
  return Math.round(base * clampFontSizeMultiplier(osMultiplier) * 100) / 100
}

/** Step through the three supported large-text tiers for a settings toggle. */
export const LARGE_TEXT_TIERS = [1, 1.3, 1.6] as const
export type LargeTextTier = (typeof LARGE_TEXT_TIERS)[number]

export function nextLargeTextTier(current: number): LargeTextTier {
  const idx = LARGE_TEXT_TIERS.findIndex((t) => t > current + 1e-6)
  return (idx === -1 ? LARGE_TEXT_TIERS[0] : LARGE_TEXT_TIERS[idx]) as LargeTextTier
}
