// packages/mobile/src/design/components/ErrorScreen.tsx
//
// Full-screen error surface (IMPLEMENTATION-PROMPT §5.9 "error/empty states").
// Renders a user-friendly page for a caught `AppError` or an arbitrary thrown value,
// mapping every code through the i18n catalogue so no internal error_code or stack
// trace is ever shown to the user. The single correct action (retry / go online /
// re-login / contact admin) is surfaced as the primary button; the raw error is
// reported to Sentry in the background.
//
// Two entry points:
//   1. `ErrorScreen` — full bleed, no chrome. Used by `ErrorBoundary` fallback.
//   2. `ErrorScreenCard` — card-constrained variant for in-page error blocks.

import React from "react"
import { View, ScrollView, StyleSheet } from "react-native"
import { theme } from "../theme"
import { Text } from "./Text"
import { Button } from "./Button"
import { Icon } from "./Icon"
import { t } from "@/core/i18n"
import { captureException } from "@/core/sentry"
import type { AppError } from "@/core/error"
import { fromUnknown } from "@/core/error"
import { isFatal } from "@/core/errorCodes"

export interface ErrorScreenProps {
  error: AppError | unknown
  region?: string
  onAction?: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  fatal?: boolean
  testID?: string
}

function resolveAppError(error: AppError | unknown): AppError {
  if (error && typeof error === "object" && "code" in error && typeof (error as AppError).code === "string") {
    return error as AppError
  }
  return fromUnknown(error)
}

function iconForCode(code: string): "error" | "cloud_off" | "block" | "help" {
  if (code === "NETWORK_UNAVAILABLE") return "cloud_off"
  if (code === "NOT_FOUND") return "error"
  if (isFatal(code)) return "block"
  return "error"
}

export function ErrorScreen({
  error,
  region,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  fatal,
  testID,
}: ErrorScreenProps): React.ReactElement {
  const appError = resolveAppError(error)
  const message = t(`errors.${appError.code}`) || appError.message || t("common.unknownError")
  const actionLabel = onAction ? t(`errorActions.${appError.action}`) : undefined
  const isFatalError = fatal ?? appError.fatal

  React.useEffect(() => {
    captureException(error, {
      code: appError.code,
      route: region,
      message: appError.message,
    })
  }, [error, appError.code, appError.message, region])

  return (
    <ScrollView
      testID={testID ?? "error-screen"}
      contentContainerStyle={styles.container}
      accessibilityRole="alert"
    >
      <View style={styles.iconWrapper}>
        <Icon
          name={iconForCode(appError.code)}
          size={48}
          color={isFatalError ? theme.colors.error : theme.colors.supportWarning}
        />
      </View>

      <Text preset="heading02" align="center" color={theme.colors.textPrimary} style={styles.title}>
        {isFatalError ? t("errors.fatalTitle") : t("errors.genericTitle")}
      </Text>

      <Text preset="body01" align="center" color={theme.colors.textSecondary} style={styles.message}>
        {message}
      </Text>

      {actionLabel && onAction && !isFatalError ? (
        <View style={styles.buttonRow}>
          <Button variant="primary" onPress={onAction} label={actionLabel} testID="error-action-button" />
          {secondaryActionLabel && onSecondaryAction ? (
            <Button variant="secondary" onPress={onSecondaryAction} label={secondaryActionLabel} testID="error-secondary-button" />
          ) : null}
        </View>
      ) : null}

      {isFatalError ? (
        <View style={styles.buttonRow}>
          <Button
            variant="primary"
            onPress={onAction ?? (() => {})}
            label={appError.action === "relogin" ? t("errorActions.relogin") : t("errorActions.contact_admin")}
            testID="error-fatal-button"
          />
        </View>
      ) : null}
    </ScrollView>
  )
}

/**
 * Constrained card variant for in-page error blocks. Reuses the same i18n mapping
 * and Sentry reporting as `ErrorScreen` but renders inside a card rather than taking
 * over the full viewport.
 */
export function ErrorScreenCard({
  error,
  region,
  onAction,
  testID,
}: ErrorScreenProps): React.ReactElement {
  const appError = resolveAppError(error)
  const message = t(`errors.${appError.code}`) || appError.message || t("common.unknownError")
  const actionLabel = onAction ? t(`errorActions.${appError.action}`) : undefined

  React.useEffect(() => {
    captureException(error, {
      code: appError.code,
      route: region,
      message: appError.message,
    })
  }, [error, appError.code, appError.message, region])

  return (
    <View testID={testID ?? "error-screen-card"} style={styles.card} accessibilityRole="alert">
      <View style={styles.cardHeader}>
        <Icon name={iconForCode(appError.code)} size={20} color={theme.colors.supportError} />
        <Text preset="bodyStrong" color={theme.colors.textPrimary}>
          {t("errors.genericTitle")}
        </Text>
      </View>
      <Text preset="body02" color={theme.colors.onSurfaceVariant} style={styles.cardMessage}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button variant="primary" onPress={onAction} label={actionLabel} style={styles.cardButton} testID="error-card-action-button" />
      ) : null}
    </View>
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
  message: {
    marginBottom: theme.spacing.xl,
    maxWidth: 280,
    alignSelf: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "center",
  },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.errorContainer,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  cardMessage: {
    marginBottom: theme.spacing.md,
  },
  cardButton: {
    alignSelf: "flex-start",
  },
})