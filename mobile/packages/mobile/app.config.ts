import type { ExpoConfig } from 'expo/config';
// APP_VARIANT is set by the EAS profile: "driver" (phone) or "admin" (tablet).
const variant = process.env.APP_VARIANT ?? 'driver';
const config: ExpoConfig = {
  name: variant === 'admin' ? 'Helix Admin' : 'Helix',
  slug: 'helix',
  version: '0.1.0',
  orientation: variant === 'admin' ? 'landscape' : 'portrait',
  scheme: 'helix',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: { image: './assets/splash.png', resizeMode: 'contain', backgroundColor: '#E6EAE9' },
  // NO googleServicesFile: notifications are delivered by the realtime gateway the app already holds open,
  // turned into LOCAL notifications (src/push.ts). There is no Firebase project, no FCM token and no
  // google-services.json. `test/guards.test.ts` fails if either comes back.
  android: { adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0F6B4F' }, package: variant === 'admin' ? 'africa.helix.admin' : 'africa.helix.driver', config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY } }, allowBackup: false, permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS'] },
  ios: { supportsTablet: true, bundleIdentifier: 'africa.helix.app' },
  plugins: ['expo-dev-client', ['expo-build-properties', { android: { minSdkVersion: 29, enableProguardInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true } }], 'expo-document-picker', 'expo-secure-store', 'expo-sqlite', 'expo-localization', 'expo-font', ['expo-camera', { cameraPermission: 'Used to photograph odometers, receipts and defects.' }]],
  extra: { apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1', wsUrl: process.env.WS_URL ?? 'ws://localhost:8081', variant, sslPins: process.env.SSL_PINS ?? '', adminContact: process.env.ADMIN_CONTACT ?? '', requirePinning: process.env.REQUIRE_PINNING === '1' },
  // expo-notifications is used ONLY for locally scheduled notifications (Android NotificationManager).
  // It is not a push SDK here: no FCM sender id, no google-services.json, no device token.
};
export default config;
