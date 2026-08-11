declare module "@sentry/react-native" {
  export interface SentryReactNativeOptions {
    dsn?: string;
    release?: string;
    environment?: string;
    tracesSampleRate?: number;
    _experiments?: Record<string, unknown>;
  }

  export interface CaptureContext {
    tags?: Record<string, string>;
    user?: { id?: string; email?: string; username?: string };
    extra?: Record<string, unknown>;
  }

  export const SentryReactNative: {
    init(options: SentryReactNativeOptions): void;
    captureException(error: Error, context?: CaptureContext): void;
    captureMessage(message: string, level?: string): void;
    flush(timeoutMs?: number): Promise<boolean>;
    setTags(tags: Record<string, string>): void;
    setUser(user: { id?: string; email?: string; username?: string } | null): void;
    withScope<T>(callback: (scope: unknown) => T): T;
  };

  export default SentryReactNative;
}
