// packages/api/src/http/routes/vehicleIssue.ts
// Driver-reported vehicle issues (14_vehicle_issues.sql, spec `report_vehicle_issue`). This is the
// dedicated non-accident defect surface: the driver app posts here instead of opening an accident
// report. The write runs through executeWrite so the audit entry + outbox event commit with the
// insert (D8) and carries Idempotency-Key (C5.1); the read uses a pooled client.
//
// The router declares absolute `/vehicles/...` paths internally and is therefore mounted at the API
// base, like createVehicleRouter. It is registered AFTER the vehicle router, whose `/vehicles/:id`
// GET would otherwise shadow nothing here (the sub-path segment `/issues` makes them disjoint).

import { Router, type Request, type Response } from "express";
import {
  Forbidden,
  VehicleIssueCreateSchema,
  type IdempotencyService,
  type PermissionCode,
  type PoolLike,
  type Principal,
} from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { CursorQuerySchema } from "../pagination";
import { withClient } from "../../db/withClient";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;

export interface VehicleIssueRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createVehicleIssueRouter(deps: VehicleIssueRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Report an issue (driver) ─────────────────────────────────────────────────────────────
  router.post(
    "/vehicles/:vehicleId/issues",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("vehicle:report")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(VehicleIssueCreateSchema, req);
        const svc = makeServices(tx.client, infra);
        // The reporter is always the calling driver — never a body field, so one driver can never
        // file a report in another driver's name (06 §2).
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden("Only a driver can report a vehicle issue") as never;

        const result = await svc.vehicleIssue.report(tx, req.params.vehicleId!, driver.id, input);
        if (!result.ok) return result.error as never;

        tx.audit({
          action: "CREATE",
          entity_table: "app.vehicle_issues",
          entity_id: result.value.issue_id,
          actor_user_id: principal.userId,
          actor_email: principal.email,
          actor_role_codes: principal.roles,
          new_value: { vehicle_id: result.value.vehicle_id, category: input.category, severity: result.value.severity },
          request_id: req.requestId,
          ip_address: req.ip ?? undefined,
          user_agent: req.header("user-agent") ?? undefined,
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 201, body: result.value, resourceId: result.value.issue_id } as never;
      }),
    ),
  );

  // ── Issues for a vehicle (maintenance triage / driver history) ───────────────────────────
  router.get(
    "/vehicles/:vehicleId/issues",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("asset:read"), asPerm("maintenance:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.vehicleIssue.getForVehicle(req.params.vehicleId!, {
          limit: query.limit,
          cursor: query.cursor ?? null,
        });
        if (!result.ok) {
          const problem = result.error.toProblem();
          res
            .status(problem.status)
            .type("application/problem+json")
            .json({ ...problem, instance: req.requestId });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  return router;
}
