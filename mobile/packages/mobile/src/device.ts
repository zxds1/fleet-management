import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { ENDPOINTS, url } from './api/endpoints';
import { api, session } from './services';
import { DeviceRefreshResponseSchema, DeviceRegisterResponseSchema } from '@fleet/shared';
import { newId } from './core/uuid';
import { z } from 'zod';
import { decodeJwt } from './core/jwt';

/** Stable per-install id. Deliberately NOT cleared on logout (the server binds the device, not the session). */
export async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync('device_id');
  if (!id) { id = newId(); await SecureStore.setItemAsync('device_id', id); }
  return id;
}

/**
 * C-15 resolved: `device_id_hash` is SHA-256 of the install's random device id. The backend stores
 * it on `app.driver_devices.device_id_hash` and matches it exactly (`DeviceRegisterSchema` requires
 * >= 16 chars, and `findAnyByHash` compares the whole string) — it is not salted or truncated.
 * `min(16)` is satisfied by a hex SHA-256 (64 chars).
 */
export const getDeviceHash = async (): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, await getDeviceId());

const platform = () => (Platform.OS === 'ios' ? 'ios' : 'android');

/**
 * C-01 resolved. There is no `DEVICE_UNKNOWN` error code and no unauthenticated registration route:
 * a phone is registered with `POST /auth/devices` immediately AFTER a successful login, carrying the
 * bearer token the login returned. A brand-new phone is therefore not blocked — the driver signs in
 * once and the device is bound from then on.
 *
 * The server's schema still accepts an optional `push_token` and nothing else writes one: notifications are
 * delivered by the realtime gateway as local notifications (see src/push.ts), so there is no Firebase token
 * to send. The field is left out rather than sent as null, because the backend's upsert COALESCEs it.
 */
export async function registerDevice(): Promise<string> {
  const r = await api.post(url(ENDPOINTS.registerDevice), {
    schema: DeviceRegisterResponseSchema,
    body: {
      device_id_hash: await getDeviceHash(),
      device_label: Device.deviceName ?? undefined,
      device_model: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || undefined,
      os_version: `${Platform.OS} ${Device.osVersion ?? ''}`.trim(),
      app_version: Constants.expoConfig?.version ?? undefined,
    },
  });
  await SecureStore.setItemAsync('device_id_server', r.device_id);
  return r.device_id;
}

/** The server-side `app.driver_devices.id` for this phone, once registered (admin revoke targets this). */
export const registeredDeviceId = (): Promise<string | null> => SecureStore.getItemAsync('device_id_server');

/**
 * B-12 resolved: the PIN never leaves the device. `POST /auth/devices/pin` takes an EMPTY body and
 * the server only records that a PIN exists, which is what makes the offline unlock auditable.
 */
export async function setServerPinFlag(): Promise<void> {
  await api.post(url(ENDPOINTS.setPin), { body: {} });
}

export async function setServerAndLocalPin(pin: string): Promise<void> {
  await session.setPin(pin);
  await setServerPinFlag();
}

/**
 * The device-bound refresh token. Its `offline_until` is the server's own 24 h offline ceiling
 * (`auth.device_offline_max_hours`, via `DeviceService.bindRefresh`), so the app can enforce the same
 * window offline without guessing it.
 */
export async function bindDeviceRefreshToken(): Promise<string | null> {
  const r = await api.post(url(ENDPOINTS.refreshDeviceToken), { schema: DeviceRefreshResponseSchema });
  await SecureStore.setItemAsync('refresh_token', r.refresh_token);
  await session.saveTokens({
    access_token: (await session.getAccessToken()) ?? '',
    refresh_token: r.refresh_token,
    offline_until: r.offline_until,
  });
  return r.offline_until;
}

/** Revokes this phone by its server-side id (admin capability, `device:revoke`). */
export async function revokeThisDevice(): Promise<void> {
  const id = await registeredDeviceId();
  if (id) await api.post(url(ENDPOINTS.revokeDevice, { id }));
}

/** Lists every device bound to the caller's account. */
export async function getDevices() {
  const tok = await session.getAccessToken();
  const claims = decodeJwt(tok ?? null);
  const meId = claims?.sub ?? null;
  const r = await api.get(url(ENDPOINTS.drivers), { schema: z.object({ data: z.array(z.object({ user_id: z.string().uuid(), devices: z.array(z.object({ device_id: z.string().uuid(), platform: z.enum(['ios', 'android']), last_seen_at: z.string().nullable() })) })) }) });
  const me = r.data.find((u: { user_id: string }) => u.user_id === meId);
  return me?.devices ?? [];
}

/** Revoke one of the caller's own devices by server-side id. */
export async function revokeCurrentDevice(device_id: string): Promise<void> {
  await api.post(url(ENDPOINTS.revokeOwnDevice, { id: device_id }));
  await SecureStore.deleteItemAsync('device_id_server');
}