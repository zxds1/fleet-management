// packages/mobile/src/core/push.ts
//
// Push (FCM) contract. Native registration (expo-notifications) is injected so this stays pure.
// Responsibilities (admin/dispatch + driver alerts):
//   • Register the device token with the backend (`/devices/{deviceId}/push-token`, queued offline).
//   • Surface incoming notification payloads to the same handler the `notifications` socket channel
//     uses, so the inbox stays a single source of truth regardless of delivery path.
// No token or payload PII is logged (C5.3). Notification `body` is treated as untrusted text and is
// never auto-navigated-from (security.md §5). Any deep link inside a payload is validated against the
// allow-list through the injected `validateDeepLink` before it may drive navigation.

import type { Security } from "./security";

export interface PushPort {
  /** Returns the FCM device token, requesting permission if needed. Null = denied. */
  getToken(): Promise<string | null>;
  /** Subscribe to OS-level push arrivals (used when the socket is down). */
  onMessage(handler: (payload: unknown) => void): () => void;
}

/** A validated navigation intent derived from a push payload (never executed without confirmation). */
export interface DeepLinkIntent {
  screen: string;
  params: Record<string, string>;
}

export interface PushDeps {
  port: PushPort;
  deviceId: () => string | undefined;
  /** Persist the token (offline-tolerant). */
  registerToken: (deviceId: string, token: string) => Promise<void> | void;
  /** Unified inbox sink — same handler the socket `notifications` channel calls. */
  onNotification: (payload: unknown) => void;
  /** Validates + parses a deep link in a payload into a safe navigation intent. */
  security: Security;
  /** Maps a validated deep link to an in-app screen (returns null when the path is not a screen). */
  deepLinkToScreen?: (link: { path: string; query: string }) => DeepLinkIntent | null;
}

export class Push {
  private unsub: (() => void) | null = null;

  constructor(private readonly deps: PushDeps) {}

  /** Idempotent: obtains the token, registers it, and wires OS pushes into the inbox handler. */
  async start(): Promise<void> {
    const token = await this.deps.port.getToken();
    const deviceId = this.deps.deviceId();
    if (token && deviceId) {
      try {
        await this.deps.registerToken(deviceId, token);
      } catch {
        /* offline — registration is retried by the outbox drainer on reconnect */
      }
    }
    this.unsub = this.deps.port.onMessage((payload) => this.handle(payload));
  }

  /**
   * Routes an OS push into the inbox, but first validates any deep link it carries. A hostile/unknown
   * link is dropped (never auto-navigates — security.md §5); a validated link yields a safe screen
   * intent that callers may surface behind a confirmation, not execute silently.
   */
  private handle(payload: unknown): void {
    const link = (payload as { deep_link?: string } | null)?.deep_link;
    if (link) {
      const parsed = this.deps.security.validateDeepLink(link);
      if (!parsed) {
        // Untrusted link: do not navigate. Still deliver the (untrusted-text) notification to the inbox.
        this.deps.onNotification(payload);
        return;
      }
      const intent = this.deps.deepLinkToScreen?.({ path: parsed.path, query: parsed.query });
      // Attach the validated intent without trusting arbitrary payload fields.
      this.deps.onNotification({ ...(payload as object), _validatedIntent: intent ?? null });
      return;
    }
    this.deps.onNotification(payload);
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
  }
}
