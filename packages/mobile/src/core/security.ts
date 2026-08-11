// packages/mobile/src/core/security.ts
//
// Mobile app hardening (security.md §9, S-4). Pure logic over injected native ports so the refusal /
// validation rules are unit-testable in node without Metro/native.
//
// Three controls, all fail-closed:
//   • Root / jailbreak detection — refuse to run (or block offline PIN) on compromised devices.
//   • Tamper / repackaging — refuse offline PIN when the app signature/checksum is not trusted.
//   • Certificate pinning — verify the API/WS/S3 endpoint pins before any request (the network layer
//     enforces the pin; this module is the policy/allow-list + a pure verify helper for tests).
//   • Deep-link validation — only allow-listed schemes/hosts may navigate; never auto-run a sensitive
//     action from a link without confirmation.

export type IntegrityViolation = "rooted" | "tampered";

export interface DeviceIntegrityPort {
  /** True on a rooted (Android) or jailbroken (iOS) device. */
  isRooted(): Promise<boolean> | boolean;
  /** True when the installed app package signature/checksum is not the distribution one. */
  isTampered(): Promise<boolean> | boolean;
}

export interface PinVerifier {
  /** Re-checks integrity at the moment a sensitive local secret (offline PIN) is used. */
  allowOfflineSecret(): boolean;
}

/** A pinned endpoint the client will refuse to talk to if the cert chain does not match. */
export interface PinnedEndpoint {
  host: string;
  /** One or more base64 SPKI SHA-256 pins (RFC 7469 `pin-sha256`). */
  pins: string[];
}

export interface SecurityConfig {
  /** Endpoints that must be certificate-pinned. */
  pins: PinnedEndpoint[];
  /** Allowed deep-link schemes (without `://`). */
  deepLinkSchemes: string[];
  /** Allowed deep-link hosts; `*` permits any host for a given scheme. */
  deepLinkHosts: string[];
  /** When true, a rooted device blocks the whole app (default per security.md §9). */
  refuseOnRooted: boolean;
}

export interface SecurityDeps {
  integrity: DeviceIntegrityPort;
  config: SecurityConfig;
}

export interface IntegrityReport {
  rooted: boolean;
  tampered: boolean;
  /** The reason the app should refuse to run, or null when safe. */
  blockReason: IntegrityViolation | null;
  /** Whether the offline PIN may be used (false on compromise). */
  allowOfflinePin: boolean;
}

export class Security {
  constructor(private readonly deps: SecurityDeps) {}

  /** The resolved security config (pins, deep-link allow-list, etc.). */
  get config(): SecurityConfig {
    return this.deps.config;
  }

  /** Synchronous snapshot is fine for the boot gate; ports may be sync or async. */
  async checkIntegrity(): Promise<IntegrityReport> {
    const rooted = await this.deps.integrity.isRooted();
    const tampered = await this.deps.integrity.isTampered();
    const blockReason: IntegrityViolation | null = rooted
      ? "rooted"
      : tampered
        ? "tampered"
        : null;
    // Offline PIN (B12) is withheld on ANY compromise even when the app is allowed to run.
    const allowOfflinePin = !rooted && !tampered;
    return { rooted, tampered, blockReason, allowOfflinePin };
  }

  /** True when the process must refuse to start (security.md §9: refuse to run on rooted). */
  async shouldRefuseRun(): Promise<boolean> {
    const report = await this.checkIntegrity();
    if (!report.blockReason) return false;
    if (report.blockReason === "rooted") return this.deps.config.refuseOnRooted;
    // Tampering always blocks (repackaging must never be trusted).
    return true;
  }

  /** Validate a certificate pin for a host; returns true only on an exact pin match. */
  verifyPin(host: string, presentedPin: string): boolean {
    const endpoint = this.deps.config.pins.find((p) => p.host === host);
    if (!endpoint) return false;
    return endpoint.pins.includes(presentedPin);
  }

  /**
   * Validate an incoming deep link. Returns the normalised target or null when the link is outside
   * the allow-list. Never throws on hostile input (security.md §5: treat all input as untrusted).
   */
  validateDeepLink(link: string): { scheme: string; host: string; path: string; query: string } | null {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return null;
    }
    const scheme = url.protocol.replace(/:$/, "");
    if (!this.deps.config.deepLinkSchemes.includes(scheme)) return null;
    if (!this.deps.config.deepLinkHosts.includes("*") && !this.deps.config.deepLinkHosts.includes(url.hostname)) {
      return null;
    }
    return { scheme, host: url.hostname, path: url.pathname, query: url.search };
  }
}

/** Default config used by the app; credentials/pins are injected at EAS build time. */
export function defaultSecurityConfig(pins: PinnedEndpoint[] = []): SecurityConfig {
  return {
    pins,
    deepLinkSchemes: ["fleet", "https"],
    deepLinkHosts: ["link.fleet.internal", "fleet.internal"],
    refuseOnRooted: true,
  };
}
