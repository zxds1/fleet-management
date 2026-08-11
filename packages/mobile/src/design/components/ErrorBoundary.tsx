// packages/mobile/src/design/components/ErrorBoundary.tsx
//
// Top-level React error boundary (IMPLEMENTATION-PROMPT §5.9 "error/empty states"). Catches render-time
// crashes so a single bad screen does not blank the whole app. Shows the localized unknown-error copy
// and a retry that remounts the tree. Never logs the stack to a user-visible surface.

import React from "react";
import { View } from "react-native";
import { theme } from "../theme";
import { Text } from "./Text";
import { Button } from "./Button";
import { t } from "@/core/i18n";
import { captureException } from "@/core/sentry";

interface Props {
  children: React.ReactNode;
  /** Optional label for the crashed region (e.g. screen name) — kept internal, not user PII. */
  region?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    captureException(error, {
      route: this.props.region,
      message: info.componentStack ?? undefined,
    });
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View
        testID="error-boundary"
        style={{
          flex: 1,
          padding: theme.spacing[5],
          justifyContent: "center",
          backgroundColor: theme.colors.background,
        }}
        accessibilityRole="alert"
      >
        <Text style={{ ...theme.textStyle.heading02, color: theme.colors.textPrimary }}>
          {t("common.unknownError")}
        </Text>
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button variant="primary" onPress={this.reset}>
            {t("common.retry")}
          </Button>
        </View>
      </View>
    );
  }
}
