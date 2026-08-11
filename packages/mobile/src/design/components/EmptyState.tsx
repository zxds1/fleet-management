// packages/mobile/src/design/components/EmptyState.tsx
// `EmptyState` for empty feeds/inboxes (flows.md §D "Empty: EmptyState with contextual copy +
// primary action"). All copy comes from the caller via i18n (D-10).

import React from "react";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "../tokens";
import { Button } from "./Button";
import { Text } from "./Text";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** The single contextual action, e.g. "No active shift — Clock In". */
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
  testID?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon,
  testID,
}: EmptyStateProps): React.ReactElement {
  return (
    <View testID={testID} style={styles.wrapper} accessibilityRole="summary">
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text variant="subtitle" align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="body" color={colors.onSurfaceVariant} align="center" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  icon: { marginBottom: spacing.sm },
  description: { marginTop: spacing.xs },
  action: { marginTop: spacing.md },
});
