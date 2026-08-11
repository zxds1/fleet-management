// packages/api/src/http/routes/insights.ts
// Read-only insights routes (03 §2.7): the unified open-anomaly feed, expiring asset documents, and
// the live vehicle display-state snapshot. Every GET here authenticates and checks a permission: the
// openapi contract applies `bearerAuth` globally and only /auth/login + /telemetry/webhook opt out, so
// the list/snapshot polling endpoints are NOT public despite carrying no idempotency. All use a
// pooled client (D8 read path) and keyset pagination (D7). The anomaly/document list responses are
// CursorPage envelopes; the dashboard and the detail routes are single objects.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { withClient } from "../../db/withClient";
import { ownScopeDriverId } from "../ownScope";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

/** Free-text renewal note recorded by the admin against a document (C.16). */
const RenewalNoteSchema = z.object({
  note: z.string().min(1).max(2000),
});

const DomainEnum = z.enum(["FUEL", "HOS", "ACCIDENT", "MAINTENANCE", "SECURITY"]);

/**
 * `domains` arrives over the wire as a comma-joined string (`?domains=FUEL,HOS`), as a repeated
 * key (`?domains=FUEL&domains=HOS`, which Express parses to an array), or absent. Normalise all
 * three to a validated array so a client using the documented form-style array is never a 400.
 */
const DomainsQuery = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const parts = (Array.isArray(v) ? v : v.split(","))
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    return parts.length > 0 ? parts : undefined;
  })
  .pipe(z.array(DomainEnum).nonempty().optional());

const AnomalyQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  domains: DomainsQuery,
});
const DocumentQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  within_days: z.coerce.number().int().min(0).max(3650).default(30),
});

export interface InsightsRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createInsightsRouter(deps: InsightsRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Unified open-anomaly feed ────────────────────────────────────────────────────────────
  // `report:read` sees the whole fleet; a DRIVER (asset:read) is narrowed to their own rows (B.16).
  router.get(
    "/anomalies",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("report:read"), asPerm("asset:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(AnomalyQuerySchema, req);
        const svc = makeServices(client, infra);
        const driverId = await ownScopeDriverId(req, svc, "report:read");
        const result = await svc.anomaly.feed({
          domains: query.domains,
          limit: query.limit,
          cursor: query.cursor,
          ...(driverId ? { driverId } : {}),
        });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Expiring asset documents ──────────────────────────────────────────────────────────────
  // `document:read` sees every asset; a DRIVER (asset:read) sees only their own documents (B.19).
  router.get(
    "/documents/expiring",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("document:read"), asPerm("asset:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(DocumentQuerySchema, req);
        const svc = makeServices(client, infra);
        const driverId = await ownScopeDriverId(req, svc, "document:read");
        const result = await svc.document.expiring({
          withinDays: query.within_days,
          limit: query.limit,
          cursor: query.cursor,
          ...(driverId ? { driverId } : {}),
        });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Single document detail (C.16 admin detail screen) ─────────────────────────────────────
  // MUST stay declared after `/documents/expiring`, otherwise `:id` would swallow "expiring".
  router.get(
    "/documents/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("document:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.document.getDocument(req.params.id!);
        if (!result.ok) {
          const status = result.error.httpStatus ?? 422;
          res.status(status).json({ error_code: result.error.error_code, status, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Record a renewal note on a document (C.16 detail screen write) ─────────────────────────
  // Distinct method (POST) and a deeper path than the `GET /documents/:id` read above, so neither
  // route can shadow the other regardless of declaration order. Runs through executeWrite so the
  // note and its audit entry commit together (D8).
  router.post(
    "/documents/:id/renewal-note",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("document:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(RenewalNoteSchema, req);
        const svc = makeServices(tx.client, infra);
        const before = await svc.document.getDocument(req.params.id!);
        const result = await svc.document.setRenewalNote(req.params.id!, input.note);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.asset_documents",
          entity_id: result.value.document_id,
          actor_user_id: principal.userId,
          changed_fields: ["notes"],
          old_value: before.ok ? { notes: before.value.notes } : undefined,
          new_value: { notes: input.note },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "DOCUMENT_RENEWAL_NOTE",
        });
        return { status: 200, body: result.value, resourceId: result.value.document_id } as never;
      }),
    ),
  );

  // ── Single anomaly detail (C.14 admin detail screen) ───────────────────────────────────────
  // Declared after `/anomalies` list so `:id` does not shadow the feed.
  router.get(
    "/anomalies/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("anomaly:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.anomaly.getAnomaly(req.params.id!);
        if (!result.ok) {
          const status = result.error.httpStatus ?? 422;
          res.status(status).json({ error_code: result.error.error_code, status, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Live vehicle display-state snapshot (N5) ───────────────────────────────────────────────
  // `report:read` sees the whole map; a DRIVER (asset:read) sees only their own vehicle (B.10).
  router.get(
    "/dashboard/vehicle-states",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("report:read"), asPerm("asset:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const driverId = await ownScopeDriverId(req, svc, "report:read");
        const result = await svc.dashboard.vehicleStates(driverId ? { driverId } : {});
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  return router;
}
