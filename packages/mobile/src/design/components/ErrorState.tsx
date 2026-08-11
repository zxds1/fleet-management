// packages/mobile/src/design/components/ErrorState.tsx
import React from "react";
import { View } from "react-native";
import { theme } from "../theme";
import { Text } from "./Text";
import { Button } from "./Button";
import { t } from "@/core/i18n";
import type { AppError } from "@/core/error";

export interface ErrorStateProps {
  error: AppError;
  onAction?: () => void;
  testID?: string;
}

/**
 * The single error surface required by D: an `error_code` mapped to localized copy + the one
 * correct action. We never show a raw server message; the i18n string keyed by `error.code` is the
 * source of truth, and `errorActions[action]` is the label. Codes that map to `none` show only the
 * copy with a dismiss-style button.
 */
export function ErrorState({ error, onAction, testID }: ErrorStateProps) {
  const message = t(`errors.${error.code}`) || error.message || t("common.unknownError");
  const actionLabel = onAction ? t(`errorActions.${error.action}`) : undefined;

  return (
    <View
      testID={testID ?? "error-state"}
      style={{
        padding: theme.spacing[5],
        borderLeftWidth: 4,
        borderLeftColor: theme.colors.supportError,
        backgroundColor: theme.colors.supportErrorLight,
        borderRadius: theme.radius.none,
      }}
    >
      <Text preset="bodyStrong" color={theme.colors.textPrimary}>
        {message}
      </Text>
      {onAction && actionLabel && (
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button variant={error.action === "contact_admin" ? "secondary" : "primary"} onPress={onAction}>
            {actionLabel}
          </Button>
        </View>
      )}
    </View>
  );
}
