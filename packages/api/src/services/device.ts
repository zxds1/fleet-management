// packages/api/src/services/device.ts
// Driver device registration, PIN state and the device-bound refresh token (02-auth.md §4, B12).
// The driver PIN is never sent to the server and is never stored — only `pin_set_at` records that a
// local PIN exists. The device-bound refresh token enables the offline login path; its hash lives in
// driver_devices.refresh_token_hash and its usability is capped by offline_window_expires_at
// (13_device_pin_offline.sql).

import type { ConfigClient, Result } from "@fleet/shared";
import { DeviceRevoked, err, NotFound, ok } from "@fleet/shared";
import type { TokenService } from "../security/tokens";
import { hashToken } from "../security/tokens";
import type { DriverDeviceRepository } from "../repositories/identity";

export interface RegisterDeviceInput {
  userId: string;
  deviceIdHash: string;
  deviceLabel?: string | null;
  deviceModel?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  pushToken?: string | null;
}

export interface BindRefreshInput {
  userId: string;
  deviceIdHash: string;
}

export interface OfflinePinOutcomeInput {
  userId: string;
  deviceIdHash: string;
  failures: number;
  lockedUntil: Date | null;
  pinWiped: boolean;
}

export class DeviceService {
  constructor(
    private readonly devices: DriverDeviceRepository,
    private readonly tokens: TokenService,
    private readonly config: ConfigClient,
  ) {}

  async register(input: RegisterDeviceInput): Promise<Result<{ deviceId: string; pushToken: string | null }>> {
    const device = await this.devices.findAnyByHash(input.deviceIdHash);
    if (device && device.revoked_at) return err(new DeviceRevoked());

    const created = await this.devices.register(input);
    return ok({ deviceId: created.id, pushToken: created.push_token });
  }

  /** B12: only the fact that a PIN exists is recorded; the PIN hash never leaves the device. */
  async setPin(userId: string, deviceIdHash: string): Promise<Result<{ ok: true }>> {
    const device = await this.devices.findLive(userId, deviceIdHash);
    if (!device) return err(new NotFound("Device not registered"));
    await this.devices.markPinSet(device.id);
    return ok({ ok: true });
  }

  /** Issues a device-bound refresh token and records its hash + offline availability window. */
  async bindRefresh(input: BindRefreshInput): Promise<Result<{ refreshToken: string; expiresAt: Date; offlineUntil: Date }>> {
    const device = await this.devices.findLive(input.userId, input.deviceIdHash);
    if (!device) return err(new NotFound("Device not registered"));
    if (device.revoked_at) return err(new DeviceRevoked());

    const maxHours = await this.config.numeric("auth.device_offline_max_hours", 24);
    const refresh = this.tokens.issueRefreshToken();
    const offlineUntil = new Date(Date.now() + maxHours * 3_600_000);
    await this.devices.bindRefreshToken({
      deviceId: device.id,
      refreshTokenHash: hashToken(refresh.token),
      refreshExpiresAt: refresh.expiresAt,
      offlineWindowExpiresAt: offlineUntil,
    });
    return ok({ refreshToken: refresh.token, expiresAt: refresh.expiresAt, offlineUntil });
  }

  /** Revokes a device by its primary key (app.driver_devices.id). Used by the admin console. */
  async revokeById(deviceId: string, by: string, reason = "ADMIN_REVOKE"): Promise<Result<{ ok: true }>> {
    const device = await this.devices.getById(deviceId);
    if (!device) return err(new NotFound("Device not found"));
    await this.devices.revoke(device.id, reason, by);
    return ok({ ok: true });
  }

  async revoke(userId: string, deviceIdHash: string, by: string, reason = "ADMIN_REVOKE"): Promise<Result<{ ok: true }>> {
    const device = await this.devices.findAnyByHash(deviceIdHash);
    if (!device) return err(new NotFound("Device not found"));
    await this.devices.revoke(device.id, reason, by);
    return ok({ ok: true });
  }

  /** Mirrors the on-device PIN attempt counters (M4): 5 failures → 15 min lock, 10 → local wipe. */
  async recordOfflinePinOutcome(input: OfflinePinOutcomeInput): Promise<Result<{ ok: true }>> {
    const device = await this.devices.findAnyByHash(input.deviceIdHash);
    if (!device) return err(new NotFound("Device not found"));
    await this.devices.recordOfflinePinOutcome({
      deviceId: device.id,
      failures: input.failures,
      lockedUntil: input.lockedUntil,
      pinWiped: input.pinWiped,
    });
    return ok({ ok: true });
  }
}
