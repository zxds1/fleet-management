// packages/api/src/services/device.ts
// Driver device registration (02-auth.md §4, B13). The driver PIN and device-bound offline refresh
// token have been removed; the account is not tied to a device, so any phone may be used to sign in.
// A device record exists only for push delivery and remote revocation (B13).

import type { Result } from "@fleet/shared";
import { err, NotFound, ok } from "@fleet/shared";
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

export class DeviceService {
  constructor(private readonly devices: DriverDeviceRepository) {}

  async register(input: RegisterDeviceInput): Promise<Result<{ deviceId: string; pushToken: string | null }>> {
    const created = await this.devices.register(input);
    return ok({ deviceId: created.id, pushToken: created.push_token });
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
}
