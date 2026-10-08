import Constants from 'expo-constants';
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
export const API_BASE_URL = extra.apiBaseUrl ?? 'http://localhost:4000/api/v1';
export const WS_URL = extra.wsUrl ?? 'ws://localhost:8081';
export const SSL_PINS_RAW = extra.sslPins ?? '';
export const REQUIRE_PINNING = String(extra.requirePinning) === 'true';
export const VARIANT = extra.variant ?? 'driver';
/** tel: or mailto: link used by the "Contact admin" action. */
export const ADMIN_CONTACT = extra.adminContact ?? '';
