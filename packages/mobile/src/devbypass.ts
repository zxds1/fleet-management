import { repository } from "./repo/FleetRepository";
import { availableShells, type ActiveShell, type Principal } from "./data/types";
import { config } from "./config";

/**
 * DEV-ONLY helpers. These are gated behind `__DEV__` at the call site and are
 * stripped from production bundles, so they never ship. They exist so the UI
 * can be browsed end-to-end when the backend (packages/api) is not running.
 */

function makePrincipal(roles: Principal["roles"], perms: string[]): Principal {
  return {
    userId: "dev-user-0001",
    tenantId: "dev-tenant-0001",
    email: "dev@fleetpulse.local",
    phone: "+15550000001",
    displayName: "Dev Driver",
    roleName: roles[0] ?? "DRIVER",
    roles,
    permissions: new Set(perms),
    locale: "en",
    sessionId: "dev-session-0001",
    deviceIdHash: repository.deviceId,
  };
}

const ALL_PERMS = Object.values(
  // Mirror every Permission code so both shells are fully unlocked.
  {
    SHIFT_CLOCK_IN: "shift:clock_in",
    SHIFT_CLOCK_OUT: "shift:clock_out",
    SHIFT_READ_OWN: "shift:read_own",
    SHIFT_READ_ALL: "shift:read_all",
    SHIFT_VERIFY: "shift:verify",
    SHIFT_FORCE_CLOSE: "shift:force_close",
    FUEL_ENTER: "fuel:enter",
    FUEL_SUBMIT_PURCHASE: "fuel:submit_purchase",
    FUEL_READ: "fuel:read",
    FUEL_VERIFY: "fuel:verify",
    FUEL_RECONCILE: "fuel:reconcile",
    FUEL_CARD_MANAGE: "fuel:card_manage",
    FUEL_ADJUST: "fuel:adjust",
    INSPECTION_SUBMIT: "inspection:submit",
    INSPECTION_READ: "inspection:read",
    INSPECTION_TEMPLATE_MANAGE: "inspection:template_manage",
    ACCIDENT_REPORT: "accident:report",
    ACCIDENT_READ: "accident:read",
    ACCIDENT_ACKNOWLEDGE: "accident:acknowledge",
    ACCIDENT_UPDATE: "accident:update",
    TRAILER_READ: "trailer:read",
    TRAILER_SWAP: "trailer:swap",
    ASSET_READ: "asset:read",
    ASSET_CREATE: "asset:create",
    ASSET_UPDATE: "asset:update",
    REPORT_READ: "report:read",
    ANOMALY_READ: "anomaly:read",
    DOCUMENT_READ: "document:read",
    DOCUMENT_MANAGE: "document:manage",
    NOTIFICATION_READ: "notification:read",
    NOTIFICATION_MANAGE: "notification:manage",
    TRAINING_READ: "training:read",
    TRAINING_REVIEW: "training:review",
    TRAINING_COMPLETE: "training:complete",
    MAINTENANCE_READ: "maintenance:read",
    MAINTENANCE_RECORD: "maintenance:record",
    USER_READ: "user:read",
    USER_MANAGE: "user:manage",
    DEVICE_REVOKED: "device:revoke",
    PRIVACY_REQUEST_OWN: "privacy:request_own",
    PRIVACY_VIEW_REQUESTS_TENANT: "privacy:view_requests_tenant",
    MFA_MANAGE_OWN: "MANAGE_OWN_MFA",
    VEHICLE_REPORT: "vehicle:report",
  } as Record<string, string>,
);

/** Apply a dev bypass as the given shell. Does not touch the network. */
export function devBypass(shell: ActiveShell = "DRIVER"): void {
  const roles: Principal["roles"] =
    shell === "ADMIN"
      ? ["ADMIN", "FLEET_MANAGER", "DISPATCHER", "DRIVER"]
      : ["DRIVER"];

  const principal = makePrincipal(roles, ALL_PERMS);
  repository.devSetSession(principal, config.consentVersion, shell);
}

/** Returns the shells the bypassed principal would resolve to. */
export function devBypassShells(): ActiveShell[] {
  return availableShells(makePrincipal(["DRIVER", "ADMIN"], ALL_PERMS));
}

