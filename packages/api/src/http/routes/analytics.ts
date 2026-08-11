// packages/api/src/http/routes/analytics.ts
// Scope-aware hierarchical analytics (mounted at BOTH /analytics and /reports).
//
// Every route here is a read: `withTenantClient` opens a transaction, applies
// `SET LOCAL app.current_tenant_id` from the verified Principal so RLS is live, runs the query and
// always ROLLBACKs (D8). The service layers an explicit `tenant_id = $1` plus the caller's scope on
// top of that, so isolation survives even if the GUC were mis-bound.
//
// Authorisation is two-stage: `authenticate` + a reused read permission gets you through the door,
// then `resolveScope` decides how much of the company you actually see. An ADMIN gets the whole
// tenant; a FLEET_MANAGER only their `app.manager_assignments` slice; a DRIVER only themselves.

import { Router } from "express";
import { isErr, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { AnalyticsRangeQuerySchema } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { parseQuery } from "../validate";
import { withTenantClient, tenantContextOf } from "../../db/withClient";
import { resolveScope } from "../../services/scope";
import { resolveRange } from "../../services/analytics";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;

export interface AnalyticsRouterDeps {
  pool: PoolLike;
  infra: Infra;
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps): Router {
  const router = Router();
  const { pool, infra } = deps;

  const auth = authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" });
  // Reuses the existing fleet-read permission rather than minting a new one: analytics exposes no
  // fact a `fuel:read` holder could not already reach through the fuel and insights surfaces.
  const perm = requirePermission(asPerm("fuel:read"));

  /** Shared read wrapper: bind RLS to the caller's tenant, resolve their scope, run `fn`. */
  const scoped = <T>(
    principal: Principal,
    fn: (svc: ReturnType<typeof makeServices>, scope: Awaited<ReturnType<typeof resolveScope>>) => Promise<T>,
  ) =>
    withTenantClient(pool, tenantContextOf(principal), async (client) => {
      const svc = makeServices(client, infra);
      const scope = await resolveScope(client, principal);
      return fn(svc, scope);
    });

  // ── Company roll-up + per-manager breakdown ────────────────────────────────────────────────
  // Also serves the mobile `GET /reports/analytics`: the flat AnalyticsReportSchema counters
  // (active_fleet, fuel_spend_30d, …) are included alongside the hierarchical body.
  const company = asyncHandler(async (req, res) => {
    const principal = (req as { principal?: Principal }).principal as Principal;
    const query = parseQuery(AnalyticsRangeQuerySchema, req);
    const result = await scoped(principal, (svc, scope) =>
      svc.analytics.company(scope, resolveRange(query)),
    );
    if (isErr(result)) throw result.error;
    res.status(200).json(result.value);
  });
  router.get("/company", auth, perm, company);
  router.get("/analytics", auth, perm, company);

  // ── One manager's slice, expanded per vehicle and per driver ───────────────────────────────
  // Authorised for an ADMIN of the tenant, or for that manager themselves (checked in the service,
  // which also computes the figures from the TARGET's scope rather than the caller's).
  router.get(
    "/manager/:id",
    auth,
    perm,
    asyncHandler(async (req, res) => {
      const principal = (req as { principal?: Principal }).principal as Principal;
      const query = parseQuery(AnalyticsRangeQuerySchema, req);
      const result = await scoped(principal, (svc, scope) =>
        svc.analytics.manager(scope, principal.userId, String(req.params.id), resolveRange(query)),
      );
      if (isErr(result)) throw result.error;
      res.status(200).json(result.value);
    }),
  );

  // ── Per-vehicle KPIs (tenant + scope checked) ──────────────────────────────────────────────
  router.get(
    "/vehicle/:id",
    auth,
    perm,
    asyncHandler(async (req, res) => {
      const principal = (req as { principal?: Principal }).principal as Principal;
      const query = parseQuery(AnalyticsRangeQuerySchema, req);
      const result = await scoped(principal, (svc, scope) =>
        svc.analytics.vehicle(scope, String(req.params.id), resolveRange(query)),
      );
      if (isErr(result)) throw result.error;
      res.status(200).json(result.value);
    }),
  );

  // ── The signed-in driver's own KPIs (no driver id needed by the client) ────────────────────
  router.get(
    "/me",
    auth,
    perm,
    asyncHandler(async (req, res) => {
      const principal = (req as { principal?: Principal }).principal as Principal;
      const query = parseQuery(AnalyticsRangeQuerySchema, req);
      const result = await scoped(principal, async (svc, scope) => {
        const driverId = await svc.analytics.driverIdForUser(scope.tenant_id, principal.userId);
        // A non-driver (ADMIN/manager) calling /me has no driver row; the company view is the
        // meaningful "my numbers" answer for them.
        if (!driverId) return svc.analytics.company(scope, resolveRange(query));
        return svc.analytics.driver(scope, driverId, resolveRange(query));
      });
      if (isErr(result)) throw result.error;
      res.status(200).json(result.value);
    }),
  );

  // ── Per-driver KPIs: self, the driver's manager, or an ADMIN ───────────────────────────────
  router.get(
    "/driver/:id",
    auth,
    perm,
    asyncHandler(async (req, res) => {
      const principal = (req as { principal?: Principal }).principal as Principal;
      const query = parseQuery(AnalyticsRangeQuerySchema, req);
      const result = await scoped(principal, (svc, scope) =>
        svc.analytics.driver(scope, String(req.params.id), resolveRange(query)),
      );
      if (isErr(result)) throw result.error;
      res.status(200).json(result.value);
    }),
  );

  return router;
}
