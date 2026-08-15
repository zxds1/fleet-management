import Constants from "expo-constants";

/**
 * Resolves the API base URL. The Kotlin app reads BuildConfig.API_BASE_URL; we
 * mirror that by pulling `apiBaseUrl` from app.json `expo.extra`, defaulting to
 * the Android emulator loopback (host machine runs `npm run dev:api` on :8080).
 * Set `EXPO_PUBLIC_API_BASE_URL` to override for physical devices / iOS.
 */
const fromExtra = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl;
const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;

export const API_BASE_URL: string =
  fromEnv || fromExtra || "http://10.0.2.2:8080/api/v1";

export const config = {
  apiBaseUrl: API_BASE_URL,
  /** Consent version the client is willing to accept before blocking sensitive work. */
  consentVersion: "2026.1",
  /** Release notes URL (optional — set to empty string or undefined for in-app fallback). */
  releaseNotesUrl: process.env.EXPO_PUBLIC_RELEASE_NOTES_URL ?? "",
} as const;

