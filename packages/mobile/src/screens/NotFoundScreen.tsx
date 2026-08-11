// packages/mobile/src/screens/NotFoundScreen.tsx
//
// Custom 404 / not-found page (A.3). Shown when the user navigates to a route or
// entity that does not exist, or when a deep link targets something that has been
// removed. Never exposes internal IDs, error codes, or stack traces — only safe,
// localized copy with a single "Go back" action.

import React from "react"
import { View, ScrollView, StyleSheet } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Icon } from "@/design/components/Icon"
import { t } from "@/core/i18n"

export interface NotFoundScreenProps {
  description?: string
  actionLabel?: string
  onAction: () => void
  testID?: string
}

export function NotFoundScreen({
  description,
  actionLabel,
  onAction,
  testID,
}: NotFoundScreenProps): React.ReactElement {
  return (
    <ScrollView
      testID={testID ?? "not-found-screen"}
      contentContainerStyle={styles.container}
      accessibilityRole="alert"
    >
      <View style={styles.iconWrapper}>
        <Icon name="error" size={64} color={theme.colors.onSurfaceVariant} />
      </View>

      <Text preset="heading02" align="center" color={theme.colors.textPrimary} style={styles.title}>
        {t("errors.notFoundTitle")}
      </Text>

      <Text preset="body01" align="center" color={theme.colors.textSecondary} style={styles.description}>
        {description ?? t("errors.notFoundDescription")}
      </Text>

      <View style={styles.buttonRow}>
        <Button variant="primary" onPress={onAction} label={actionLabel ?? t("common.back")} testID="not-found-action" />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  iconWrapper: {
    alignItems: "center",
    marginBottom: theme.spacing.lg,
  },
  title: {
    marginBottom: theme.spacing.md,
  },
  description: {
    marginBottom: theme.spacing.xl,
    maxWidth: 280,
    alignSelf: "center",
  },
  buttonRow: {
    justifyContent: "center",
  },
})