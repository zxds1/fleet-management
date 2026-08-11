// packages/mobile/src/design/components/ErrorBoundary.tsx
//
// Top-level React error boundary (IMPLEMENTATION-PROMPT §5.9 "error/empty states"). Catches render-time
// crashes so a single bad screen does not blank the whole app. Shows the localized unknown-error copy
// and a retry that remounts the tree. Never logs the stack to a user-visible surface.

import React from "react";
import { captureException } from "@/core/sentry";
import { localError } from "@/core/error";
import { ErrorScreen } from "./ErrorScreen";

interface Props {
  children: React.ReactNode;
  /** Optional label for the crashed region (e.g. screen name) — kept internal, not user PII. */
  region?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: unknown;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    captureException(error, {
      route: this.props.region,
      message: info.componentStack ?? undefined,
    });
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const appError = localError("UNKNOWN");
    return (
      <ErrorScreen
        error={this.state.error ?? appError}
        region={this.props.region}
        onAction={this.reset}
        fatal={false}
        testID="error-boundary"
      />
    );
  }
}