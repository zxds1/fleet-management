// packages/api/src/http/ownScope.ts
// Shared "own scope" resolver for read routes that BOTH a driver and an admin may call (C6.2).
// A driver holds the read permission for their own records only; the fleet-wide variant of the
// same capability is what distinguishes a privileged caller. Returning the caller's driver id
// narrows the query; returning undefined means "see everything".

import type { PermissionCode, Principal } from "@fleet/shared";
import type { Request } from "express";
import type { makeServices } from "../app/compose";

/** Sentinel scope that matches no row, used when the caller can only ever see their own data. */
export const NO_SCOPE = "00000000-0000-0000-0000-000000000000";

/**
 * Returns the caller's own driver id when they lack `privileged`, so the query is narrowed to
 * their own rows; returns undefined for privileged callers. A caller with neither the privileged
 * permission nor a driver profile gets `NO_SCOPE`, never the whole fleet.
 */
export async function ownScopeDriverId(
  req: Request,
  svc: ReturnType<typeof makeServices>,
  privileged: string,
): Promise<string | undefined> {
  const principal = (req as { principal?: Principal }).principal as Principal;
  if (principal.permissions.has(privileged as PermissionCode)) return undefined;
  const driver = await svc.drivers.findByUserId(principal.userId);
  return driver?.id ?? NO_SCOPE;
}
