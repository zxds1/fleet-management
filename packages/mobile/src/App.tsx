// packages/mobile/src/App.tsx
//
// Root component + auth vertical-slice router. The flow is driven by the pure `AuthFlow` (no React
// in the decision logic); this file only renders the current step's screen and wires callbacks.
// Native ports (expo-secure-store, sqlite, biometric, socket.io) are injected in the RN entry point;
// here we fall back to in-memory fakes so the app boots and is testable without a device.

import React, { useEffect, useMemo, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { theme } from "./design/theme";
import { Text } from "./design/components/Text";
import { Button } from "./design/components/Button";
import { Logo } from "./design/components/Logo";
import { OfflineBanner } from "./design/components/OfflineBanner";
import { LoginScreen } from "./screens/auth/LoginScreen";
import { SignupScreen } from "./screens/auth/SignupScreen";
import { MfaScreen } from "./screens/auth/MfaScreen";
import { ConsentScreen } from "./screens/auth/ConsentScreen";
import { createServices, createMemorySecureStore } from "./services";
import { initSentry } from "./core/sentry";
import { nativeDeviceInfoPort } from "./core/nativeDeviceInfo";
import { t, getLocale, setLocale, availableLocales, type Locale } from "./core/i18n";
import type { AuthStep } from "./core/auth/flow";
import { DriverRouter } from "./screens/driver/DriverRouter";
import { AdminRouter } from "./screens/admin/AdminRouter";
import { Security, defaultSecurityConfig, type DeviceIntegrityPort, type PinnedEndpoint } from "./core/security";
import { ErrorBoundary } from "./design/components/ErrorBoundary";

/** Demo integrity: a clean device. Used only when demo mode is active. */
const demoIntegrity: DeviceIntegrityPort = { isRooted: () => false, isTampered: () => false };

/**
 * Resolves pinned endpoints from app.json.extra.security.certPins into the
 * `PinnedEndpoint[]` shape the `Security` class consumes. Each entry maps a
 * host to one or more base64 SPKI SHA-256 pins (RFC 7469 pin-sha256).
 */
function resolveCertPins(): PinnedEndpoint[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default;
    const extra = Constants?.manifest?.extra ?? Constants?.expoConfig?.extra;
    const certPins: Record<string, string[]> = extra?.security?.certPins ?? {};
    return Object.entries(certPins).map(([host, pins]) => ({ host, pins }));
  } catch {
    return [];
  }
}

function createSecurity(demoMode: boolean): Security {
  const integrity = demoMode ? demoIntegrity : nativeDeviceInfoPort;
  return new Security({
    integrity,
    config: defaultSecurityConfig(resolveCertPins()),
  });
}

const security = createSecurity(!!process.env.EXPO_PUBLIC_DEMO_MODE);

/** Demo fetch: stands the auth slice up without a backend (returns a DRIVER principal). */
function demoFetch(input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : (input as URL).toString();
  const body = init?.body ? JSON.parse(init.body as string) : {};
  if (url.endsWith("/auth/login")) {
    const isDriver = !!body.phone
    return Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: "demo.access",
          refresh_token: "demo.refresh",
          mfa_required: false,
          user_id: "u_demo",
          email: isDriver ? null : (body.email ?? "admin@fleet.co.ke"),
          phone: isDriver ? (body.phone ?? "+254700000000") : null,
          roles: [isDriver ? "DRIVER" : "ADMIN"],
          permissions: isDriver
            ? ["SHIFT_CREATE", "FUEL_CREATE", "INSPECTION_CREATE", "ACCIDENT_REPORT"]
            : ["USER_MANAGE", "DRIVER_REVIEW", "DASHBOARD_VIEW"],
          locale: "en",
          session_id: "s_demo",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }
  return Promise.resolve(new Response(null, { status: 204 }));
}

export function App() {
  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
  const wsUrl = process.env.EXPO_PUBLIC_WS_URL ?? "ws://localhost:4001";
  // IBM Plex Sans is the single sanctioned family (DESIGN.md). The TTFs live in
  // `assets/fonts/` and must be registered here. We load them defensively: if the asset
  // files are absent (e.g. CI without bundled fonts) the call is skipped and the OS falls
  // back gracefully — `Text`/`Input` still request the family so styling is correct once
  // the fonts are present. `useFonts` is called unconditionally to satisfy the Rules of
  // Hooks; when there are no entries it is a no-op.
  const [plexLoaded] = useFontsSafe();
  void plexLoaded;
  // Demo mode: use the in-memory fake backend so every screen is testable without a running server.
  // Set EXPO_PUBLIC_DEMO_MODE to any truthy value to enable. The login screen then shows one-tap
  // "Enter as Driver" / "Enter as Admin" buttons so you can exercise either surface.
  const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE;
  useEffect(() => {
    if (!demoMode) initSentry();
  }, [demoMode]);
  const services = useMemo(
    () =>
      createServices({
        baseUrl,
        wsUrl,
        certPins: resolveCertPins(),
        fetchImpl: demoMode
          ? (demoFetch as unknown as typeof fetch)
          : typeof fetch !== "undefined"
            ? fetch
            : (demoFetch as unknown as typeof fetch),
        // Demo mode has no gateway to reach, so real-time is disabled explicitly; with a real
        // backend the composition root supplies the socket.io-client factory.
        socketFactory: demoMode ? null : undefined,
        secureStore: createMemorySecureStore(),
      }),
    [baseUrl, wsUrl, demoMode],
  );
  const [booted, setBooted] = useState(false);
  const [step, setStep] = useState<AuthStep>("login");
  const [role, setRole] = useState<"driver" | "admin">("driver");
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [blocked, setBlocked] = useState<"rooted" | "tampered" | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      // S-4: refuse to run on a rooted/jailbroken or tampered (repackaged) device.
      const refuse = await security.shouldRefuseRun();
      if (refuse) {
        const report = await security.checkIntegrity();
        if (active) setBlocked(report.blockReason);
        return;
      }
      // Demo mode: boot to the login screen (which shows one-tap Driver/Admin entry buttons).
      // The fake backend answers the login, so either surface is reachable without a server.
      if (demoMode) {
        if (active) {
          setStep("login");
          setBooted(true);
        }
        return;
      }
      // Boot is fully local: restore() reads the secure store and begin() resolves the
      // starting step from the stored session. Neither calls the backend, so the app boots
      // (to the login screen) even when the server is offline.
      try {
        await services.session.restore();
        const s = await services.flow.begin();
        if (active) {
          // A restored session already knows which surface it belongs to; without this an admin
          // resuming the app would land in the driver router (`role` defaults to "driver").
          if (services.session.hasRole("DRIVER")) setRole("driver");
          else if (services.session.principal) setRole("admin");
          setStep(s);
          setBooted(true);
        }
      } catch {
        // A store/restore failure must not hang the splash — fall back to login.
        if (active) {
          setStep("login");
          setBooted(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [services]);

  if (blocked) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.ui01, justifyContent: "center", padding: theme.spacing[5] }} accessibilityRole="alert">
        <Text style={{ ...theme.textStyle.heading02, color: theme.colors.textPrimary }}>
          {t(`security.${blocked === "rooted" ? "rootedTitle" : "tamperedTitle"}`)}
        </Text>
        <Text style={{ ...theme.textStyle.body01, color: theme.colors.textSecondary, marginTop: theme.spacing[4] }}>
          {t(`security.${blocked === "rooted" ? "rootedBody" : "tamperedBody"}`)}
        </Text>
      </View>
    );
  }

  const switchLocale = (next: Locale) => {
    setLocale(next);
    setLocaleState(next);
  };

   if (!booted) {
     return (
       <View style={{ flex: 1, backgroundColor: theme.colors.ui01, justifyContent: "center", alignItems: "center" }}>
         <Logo size={56} />
         <ActivityIndicator color={theme.colors.interactive01} style={{ marginTop: theme.spacing[5] }} />
         <Text style={{ marginTop: theme.spacing[4], color: theme.colors.textSecondary }}>{t("boot.starting")}</Text>
       </View>
     );
   }

  const demoEnter = async (role: "driver" | "admin") => {
    const creds =
      role === "admin"
        ? { email: "admin@fleet.co.ke", password: "demo" }
        : { phone: "+254700000000", password: "demo" };
    try {
      await services.session.login(creds);
      setRole(role);
      setStep("authed");
    } catch {
      // ignore — login screen remains
    }
  };

  /**
   * Applies a step returned by the flow. The surface is decided by the authenticated principal, not
   * by the login-screen toggle or the signup entry point, so the server is always the authority on
   * which router is mounted (an admin can never be dropped into the driver UI and vice versa).
   */
  const applyStep = (next: AuthStep) => {
    if (next === "authed") {
      if (services.session.hasRole("DRIVER")) setRole("driver");
      else if (services.session.principal) setRole("admin");
    }
    setStep(next);
  };

  switch (step) {
    case "login":
      return (
        <LoginScreen
          submitting={services.flow.submitting}
          error={services.flow.error}
          demo={!!demoMode}
          onSubmit={async (identifier, password, chosen) => {
            setRole(chosen)
            applyStep(await services.flow.submitLogin(identifier, password, chosen))
          }}
          onDemoEnter={demoEnter}
          onBiometric={() => demoEnter(role)}
          onForgot={() => undefined}
          online={services.socket.status === "connected" || !!demoMode}
          onSignup={() => setStep(services.flow.goToSignup())}
        />
      );
    case "signup":
      return (
        <SignupScreen
          submitting={services.flow.submitting}
          error={services.flow.error}
          onSubmit={async (input) => applyStep(await services.flow.submitSignup(input))}
          onBack={() => setStep(services.flow.goToLogin())}
        />
      );
    case "mfa":
      return (
        <MfaScreen
          submitting={services.flow.submitting}
          error={services.flow.error}
          onSubmit={async (code) => applyStep(await services.flow.submitMfa(code))}
          onUseRecovery={() => undefined}
          onResend={() => undefined}
          onCancel={() => setStep(services.flow.goToLogin())}
        />
      );
    case "consent":
      return (
        <ConsentScreen
          version={services.flow.config.consentVersion}
          onAccept={async () => applyStep(await services.flow.acceptConsent())}
          onDecline={() => setStep(services.flow.declineConsent())}
        />
      );
    case "authed":
    default:
      // Role switch: `role` decides which root navigator is mounted, so setting it here unmounts
      // the current surface and mounts the other one. `setStep("authed")` keeps the router on the
      // authed branch (and re-affirms it when the switch is triggered from a nested screen).
      if (role === "driver") {
        return (
          <ErrorBoundary region="driver">
            <DriverRouter
              services={services}
              onLogout={() => setStep("login")}
              onSwitchRole={(next) => {
                setRole(next)
                setStep("authed")
              }}
            />
          </ErrorBoundary>
        );
      }
      return (
        <ErrorBoundary region="admin">
          <AdminRouter
            services={services}
            onLogout={() => setStep("login")}
            onSwitchRole={(next) => {
              setRole(next)
              setStep("authed")
            }}
          />
        </ErrorBoundary>
      );
  }
}

export default App;

/* -------------------------------------------------------------------------------------------
 * IBM Plex Sans font loading
 * -------------------------------------------------------------------------------------------
 * DESIGN.md mandates IBM Plex Sans as the ONLY family, and `design/tokens.ts` already asks for
 * "IBMPlexSans-Regular" / "-SemiBold" / "-Light" everywhere via `Text` and `Input`.
 *
 * Activation requires two things, and this module degrades gracefully when either is missing:
 *
 *   1. The TTFs must exist at `packages/mobile/assets/fonts/IBMPlexSans-{Regular,SemiBold,Light}.ttf`.
 *      Metro resolves `require()` of an asset at BUILD time and hard-fails the bundle if the file
 *      is absent, so each require is isolated in its own try/catch and only resolved entries are
 *      handed to `useFonts`.
 *   2. The `expo-font` package must be installed. The import is done through a guarded
 *      `require` so a missing module cannot break bundling or typechecking; the fallback is a
 *      stub that reports "loaded" immediately.
 *
 * If either is missing the app simply renders with the platform's system sans-serif — no crash,
 * no blank screen. Once both are in place the real IBM Plex Sans activates with no other code
 * changes, because the component-level `fontFamily` values are already correct.
 * ---------------------------------------------------------------------------------------- */

// Guarded import: `expo-font` may not be installed. Falling back to a stub keeps the Rules of
// Hooks intact (the "hook" is still called unconditionally) while reporting fonts as ready.
let useFonts: (map: Record<string, unknown>) => [boolean];
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ useFonts } = require("expo-font") as {
    useFonts: (map: Record<string, unknown>) => [boolean];
  });
} catch {
  useFonts = (_map: Record<string, unknown>) => [true];
}

/**
 * Builds the font map from whichever TTFs are actually bundled. Each require is isolated so a
 * single missing file degrades that one weight instead of failing the whole bundle.
 */
function resolvePlexFonts(): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    map["IBMPlexSans-Regular"] = require("../assets/fonts/IBMPlexSans-Regular.ttf");
  } catch {
    /* asset not bundled — fall back to system sans for this weight */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    map["IBMPlexSans-SemiBold"] = require("../assets/fonts/IBMPlexSans-SemiBold.ttf");
  } catch {
    /* asset not bundled — fall back to system sans for this weight */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    map["IBMPlexSans-Light"] = require("../assets/fonts/IBMPlexSans-Light.ttf");
  } catch {
    /* asset not bundled — fall back to system sans for this weight */
  }
  return map;
}

// Resolved once at module scope: the set of bundled assets cannot change at runtime, and a stable
// object identity keeps `useFonts` from re-registering on every render.
const PLEX_FONTS = resolvePlexFonts();

/**
 * Loads IBM Plex Sans, tolerating both a missing `expo-font` package and missing TTF assets.
 * `useFonts` is always called (never conditionally) to satisfy the Rules of Hooks; with an empty
 * map it is a no-op that resolves immediately.
 */
function useFontsSafe(): [boolean] {
  const [loaded] = useFonts(PLEX_FONTS);
  return [loaded];
}
