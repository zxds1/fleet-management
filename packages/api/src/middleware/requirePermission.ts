// packages/api/src/middleware/requirePermission.ts
// Authorisation guard (02 §5 / 03 §1 step 3). Permissions are the UNION across every role the
// user holds (N4 / C6.2); there is no primary role. Absence → 403 FORBIDDEN.

import type { NextFunction, Request, Response } from "express";
import { Forbidden, Unauthenticated, type PermissionCode } from "@fleet/shared";

export function requirePermission(...codes: PermissionCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) return next(new Unauthenticated());
    const granted = codes.some((code) => principal.permissions.has(code));
    if (!granted) {
      return next(new Forbidden(`Requires one of: ${codes.join(", ")}`));
    }
    next();
  };
}

/** Guard for "self or privileged" routes (e.g. a driver setting their own device PIN). */
export function requireSelfOrPermission(userIdParam: string, ...codes: PermissionCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) return next(new Unauthenticated());
    if (req.params[userIdParam] === principal.userId) return next();
    if (codes.some((code) => principal.permissions.has(code))) return next();
    next(new Forbidden(`Requires one of: ${codes.join(", ")}`));
  };
}
