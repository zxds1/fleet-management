// packages/mobile/src/design/components/StatusBadge.tsx
// Status chip. Two flavours:
//   • `DisplayStateBadge` — vehicle/asset display state, coloured by the frozen N5 precedence
//     palette (`QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED`, 08 §6).
//     When several states are concurrently true the caller passes them all and `pickDisplayState`
//     resolves the single one to render — precedence is never re-implemented at a call site.
//   • `StatusBadge` — generic tone chip for queue/verification/outbox statuses.
//
// Copy is always supplied by the caller from i18n (D-10); this component never hardcodes text.

import React from "react";
import { StyleSheet, View } from "react-native";
import { colors, displayStateColors, pickDisplayState, radius, spacing, type DisplayState } from "../tokens";
import { Text } from "./Text";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const tonePalette: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceContainerHigh, fg: colors.onSurfaceVariant },
  info: { bg: colors.infoContainer, fg: colors.primaryEmphasis },
  success: { bg: colors.successContainer, fg: colors.onSuccessContainer },
  warning: { bg: colors.warningContainer, fg: colors.onSurface },
  danger: { bg: colors.errorContainer, fg: colors.onErrorContainer },
};

export interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
  /** Squared corners (Carbon default for status chips) vs the legacy pill. Default squared. */
  shape?: "squared" | "pill";
  testID?: string;
}

export function StatusBadge({ label, tone = "neutral", shape = "squared", testID }: StatusBadgeProps): React.ReactElement {
  const p = tonePalette[tone];
  return (
    <View
      testID={testID}
      style={[shape === "pill" ? styles.chipPill : styles.chipSquared, { backgroundColor: p.bg }]}
      accessibilityRole="text"
    >
      <Text variant="label" color={p.fg} style={shape === "squared" ? styles.squaredText : undefined}>
        {label}
      </Text>
    </View>
  );
}

export interface DisplayStateBadgeProps {
  /** All concurrently-true states; N5 precedence picks the one to show. */
  states: readonly DisplayState[];
  /** Localized label for the resolved state (caller resolves via i18n). */
  labelFor: (state: DisplayState) => string;
  testID?: string;
}

export function DisplayStateBadge({ states, labelFor, testID }: DisplayStateBadgeProps): React.ReactElement {
  const resolved = pickDisplayState(states);
  const p = displayStateColors[resolved];
  return (
    <View testID={testID} style={[styles.chipSquared, styles.stateChip, { backgroundColor: p.bg }]} accessibilityRole="text">
      <View style={[styles.dot, { backgroundColor: p.fg }]} />
      <Text variant="label" color={p.fg}>
        {labelFor(resolved)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chipSquared: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.none,
    alignSelf: "flex-start",
  },
  chipPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  squaredText: { textTransform: "uppercase" as const, letterSpacing: 0.5 },
  stateChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: radius.pill, marginRight: spacing.xs },
});
