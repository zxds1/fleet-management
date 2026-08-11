// packages/api/src/http/routes/onboarding.ts
// Driver onboarding + background check (13_onboarding.sql). Mounted at `${base}/drivers/me`, which
// is a distinct literal path from the admin router's `/drivers/:id` — Express matches the literal
// segment "me" against the `:id` pattern only if this router is reached first, so app.ts mounts it
// ahead of the 404 handler and the admin surface keeps its own `/drivers/:id` semantics (the two
// routers are mounted at different base paths, so there is no shadowing).
//
// Reads use a pooled client (D8 read path); writes go through executeWrite so the audit entry and
// the idempotency completion commit in the same transaction. Request bodies are declared inline
// (route-local, non-contract schemas stay in the router file, 06 §3).

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  Forbidden,
  NotFound,
  type IdempotencyService,
  type PermissionCode,
  type PoolLike,
  type Principal,
} from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler, PROBLEM_CONTENT_TYPE } from "../problem";
import { executeWrite } from "../write";
import { parseBody } from "../validate";
import { withClient } from "../../db/withClient";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

const OnboardingProfileSchema = z
  .object({
    full_name: z.string().min(1).max(200).optional(),
    licence_number: z.string().min(1).max(80).optional(),
    licence_class: z.string().min(1).max(40).optional(),
    emergency_contact_name: z.string().min(1).max(200).optional(),
    emergency_contact_phone: z.string().min(1).max(40).optional(),
    address_json: z.record(z.unknown()).optional(),
  })
  .strict();

const BackgroundCheckSchema = z
  .object({
    ssn_encrypted: z.string().min(1).max(4000).optional(),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD").optional(),
    previous_addresses_json: z.array(z.record(z.unknown())).max(20).optional(),
    consent_given: z.boolean(),
  })
  .strict();

export interface OnboardingRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createOnboardingRouter(deps: OnboardingRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Own onboarding record (create-on-read) ────────────────────────────────────────────
  router.get(
    "/onboarding",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("onboarding:read")),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.getByUserId(principal.userId);
        if (!driver) return new NotFound("No driver profile for this user") as never;
        const result = await svc.onboarding.getOrCreate(driver.id);
        if (!result.ok) return result.error as never;
        return { status: 200, body: result.value } as never;
      }),
    ),
  );

  // ── Save the profile step ─────────────────────────────────────────────────────────────
  router.post(
    "/onboarding/profile",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("onboarding:submit")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(OnboardingProfileSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.getByUserId(principal.userId);
        if (!driver) return new NotFound("No driver profile for this user") as never;
        const result = await svc.onboarding.saveProfile(driver.id, input);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.driver_onboarding",
          entity_id: result.value.id,
          actor_user_id: principal.userId,
          changed_fields: Object.keys(input),
          new_value: input,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 200, body: result.value, resourceId: result.value.id } as never;
      }),
    ),
  );

  // ── Submit the background check ───────────────────────────────────────────────────────
  router.post(
    "/background-check",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("onboarding:submit")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(BackgroundCheckSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.getByUserId(principal.userId);
        if (!driver) return new NotFound("No driver profile for this user") as never;
        const result = await svc.onboarding.submitBackgroundCheck(driver.id, input);
        if (!result.ok) return result.error as never;
        // The SSN ciphertext is never echoed into the audit trail; only the consent decision is.
        tx.audit({
          action: "CREATE",
          entity_table: "app.driver_onboarding",
          entity_id: result.value.onboarding_id,
          actor_user_id: principal.userId,
          new_value: { background_check_status: result.value.status, consent_given: result.value.consent_given },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 200, body: result.value, resourceId: result.value.onboarding_id } as never;
      }),
    ),
  );

  // ── Current dispatch assignment (contract status endpoint) ────────────────────────────
  router.get(
    "/assignment",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("assignment:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const principal = (req as { principal?: Principal }).principal as Principal;
        const svc = makeServices(client, infra);
        const driver = await svc.drivers.getByUserId(principal.userId);
        if (!driver) {
          const problem = new Forbidden("No driver profile for this user");
          res
            .status(problem.httpStatus)
            .type(PROBLEM_CONTENT_TYPE)
            .json({ ...problem.toProblem(), instance: req.requestId });
          return;
        }
        const row = await svc.assignments.getActiveForDriver(driver.id);
        if (!row) {
          res.status(404).type(PROBLEM_CONTENT_TYPE).json({
            type: "https://docs.fleet.internal/problems/no_assignment",
            title: "No active assignment",
            status: 404,
            detail: "The driver has no active assignment.",
            instance: req.requestId,
            error_code: "NO_ASSIGNMENT",
          });
          return;
        }
        res.status(200).json(toDriverAssignmentResponse(row));
      }),
    ),
  );

  // ── Training completion status (contract status endpoint) ─────────────────────────────
  router.get(
    "/training-status",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("training:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const principal = (req as { principal?: Principal }).principal as Principal;
        const svc = makeServices(client, infra);
        const driver = await svc.drivers.getByUserId(principal.userId);
        if (!driver) {
          const problem = new Forbidden("No driver profile for this user");
          res
            .status(problem.httpStatus)
            .type(PROBLEM_CONTENT_TYPE)
            .json({ ...problem.toProblem(), instance: req.requestId });
          return;
        }
        const status = await svc.training.trainingStatus(driver.id);
        res.status(200).json(status);
      }),
    ),
  );

  return router;
}

/**
 * Projects an `app.assignments` row onto the contract's `DriverAssignment` shape for
 * `GET /drivers/me/assignment`. Returns null when there is no active assignment, which the route
 * turns into a 404 NO_ASSIGNMENT problem. Pure + exported so the mapping (and the null branch) is
 * unit-testable without a database.
 */
export function toDriverAssignmentResponse(
  row: import("../../repositories/shifts").ActiveDriverAssignmentRow | null,
): import("../../repositories/shifts").ActiveDriverAssignmentRow | null {
  if (!row) return null;
  return {
    assignment_id: row.assignment_id,
    vehicle_id: row.vehicle_id,
    status: row.status,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
  };
}
