// packages/api/src/http/routes/hardware.ts
// Tracker (hardware) provisioning surface (A1.1, N2.3), mounted at /admin/hardware.
//
// Pairing binds a physical IMEI to a vehicle and returns the SMS an installer texts to the
// tracker SIM so the device points itself at our Traccar listener. Our database owns the asset,
// the device owns nothing: the write is a single atomic UPDATE guarded by the uniqueness of the
// IMEI across the fleet (04_assets.sql vehicles_tracker_imei_unique).
//
// The provisioning inbox (GET /pending) reports first-contact state so an installer knows whether
// the SMS actually took effect, without waiting for a support call.

import { Router, type Request, type Response } from "express";
import {
  ConflictError,
  HardwarePairSchema,
  type DbClient,
  type IdempotencyService,
  type PermissionCode,
  type PoolLike,
  type Principal,
  type HardwareTrackerStatus,
} from "@fleet/shared";
import { NotFound, violation } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody } from "../validate";
import { withTenantClient, tenantContextOf } from "../../db/withClient";
import type { Infra } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;

export interface HardwareRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

// system_config.key is constrained to lowercase dotted keys, so the logical TRACCAR_PUBLIC_IP /
// TRACCAR_H02_PORT settings live under this namespace (db/schema/12_fuel_hardware_extension.sql).
const KEY_PUBLIC_IP = "traccar.public_ip";
const KEY_H02_PORT = "traccar.h02_port";
const DEFAULT_PUBLIC_IP = "127.0.0.1";
const DEFAULT_H02_PORT = "5013";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * First-contact / liveness state for a paired tracker.
 *  PENDING — paired but never seen; the configuration SMS has not taken effect yet.
 *  ONLINE  — reported within the last 5 minutes.
 *  OFFLINE — silent for up to 24 hours (parked, no signal, ignition off).
 *  LOST    — silent for over 24 hours; the device likely needs a site visit.
 */
export function getStatus(lastPing: Date | string | null, now: Date = new Date()): HardwareTrackerStatus["status"] {
  if (lastPing == null) return "PENDING";
  const seen = lastPing instanceof Date ? lastPing : new Date(lastPing);
  if (Number.isNaN(seen.getTime())) return "PENDING";
  const age = now.getTime() - seen.getTime();
  if (age <= FIVE_MINUTES_MS) return "ONLINE";
  if (age <= TWENTY_FOUR_HOURS_MS) return "OFFLINE";
  return "LOST";
}

/**
 * Builds the server-configuration SMS for a tracker brand. Teltonika devices are configured over
 * USB/Bluetooth with the vendor configurator rather than by SMS, so they return no command.
 */
export function buildSmsCommand(brand: string, ip: string, port: string): { smsCommand: string; message: string } {
  const normalised = brand.trim().toUpperCase();

  if (normalised === "TELTONIKA") {
    return {
      smsCommand: "",
      message:
        "Teltonika devices are not configured by SMS. Use the Teltonika Configurator to set the " +
        `server to ${ip}:${port}, then power-cycle the device.`,
    };
  }

  // Concox / Jimi (GT06 family) use the SET, form; H02-family devices use SERVER,.
  const isConcoxJimi =
    normalised === "CONCOX" ||
    normalised === "JIMI" ||
    normalised === "JIMI_CONCOX" ||
    normalised === "GENERIC_GT06";
  const smsCommand = isConcoxJimi ? `SET,1,${ip},${port},0#` : `SERVER,1,${ip},${port},0#`;

  return {
    smsCommand,
    message: `Send "${smsCommand}" by SMS to the tracker SIM, then power-cycle the device. It should report within 5 minutes.`,
  };
}

/** Reads a `value_type='string'` system_config entry (jsonb string literal) with a fallback. */
async function configString(client: DbClient, key: string, fallback: string): Promise<string> {
  const res = await client.query<{ value: unknown }>(
    `SELECT value FROM app.system_config WHERE key = $1`,
    [key],
  );
  const raw = res.rows[0]?.value;
  if (raw == null) return fallback;
  const value = typeof raw === "string" ? raw : String(raw);
  return value.length > 0 ? value : fallback;
}

export function createHardwareRouter(deps: HardwareRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Pair a tracker to a vehicle ────────────────────────────────────────────────────────────
  router.post(
    "/pair",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("asset:update")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(HardwarePairSchema, req);

        // The IMEI must be free fleet-wide; report the incumbent plate so the Admin can act on it.
        const clash = await tx.client.query<{ id: string; license_plate: string }>(
          `SELECT id, license_plate FROM app.vehicles
            WHERE tracker_imei = $1 AND id <> $2 AND deleted_at IS NULL
            LIMIT 1`,
          [input.trackerImei, input.vehicleId],
        );
        const taken = clash.rows[0];
        if (taken) {
          return new ConflictError(
            "TRACKER_ALREADY_PAIRED",
            "Tracker already paired",
            `IMEI ${input.trackerImei} is already paired to vehicle ${taken.license_plate}.`,
          ) as never;
        }

        const target = await tx.client.query<{ license_plate: string; tracker_imei: string | null }>(
          `SELECT license_plate, tracker_imei FROM app.vehicles
            WHERE id = $1 AND deleted_at IS NULL
            LIMIT 1`,
          [input.vehicleId],
        );
        const vehicle = target.rows[0];
        if (!vehicle) return new NotFound("Vehicle not found") as never;

        // Idempotent re-pairing (F8): if this exact IMEI is already bound to this vehicle, treat the
        // call as a Resend — re-issue the configuration SMS without touching the row. A *different*
        // IMEI on the vehicle still requires an explicit unpair first.
        const resend = vehicle.tracker_imei === input.trackerImei;
        if (vehicle.tracker_imei && !resend) {
          return violation(
            "VEHICLE_ALREADY_HAS_TRACKER",
            "Vehicle already has a tracker",
            `Vehicle ${vehicle.license_plate} is already paired to IMEI ${vehicle.tracker_imei}. Unpair it first.`,
          ) as never;
        }

        const [ip, port] = await Promise.all([
          configString(tx.client, KEY_PUBLIC_IP, DEFAULT_PUBLIC_IP),
          configString(tx.client, KEY_H02_PORT, DEFAULT_H02_PORT),
        ]);
        const { smsCommand, message } = buildSmsCommand(input.trackerBrand, ip, port);

        // Resend: the IMEI is already bound to this vehicle, so just re-issue the SMS command.
        // A fresh pair writes the binding; the audit reason reflects which path ran.
        if (!resend) {
          await tx.client.query(
            `UPDATE app.vehicles
                SET tracker_imei       = $1,
                    tracker_brand      = $2,
                    tracker_sim_number = $3,
                    tracker_paired_at  = now(),
                    updated_at         = now()
              WHERE id = $4 AND deleted_at IS NULL`,
            [input.trackerImei, input.trackerBrand, input.trackerSimNumber ?? null, input.vehicleId],
          );
        }

        tx.audit({
          action: "UPDATE",
          entity_table: "app.vehicles",
          entity_id: input.vehicleId,
          actor_user_id: principal.userId,
          actor_email: principal.email,
          actor_role_codes: principal.roles,
          changed_fields: resend ? ["tracker_paired_at"] : ["tracker_imei", "tracker_brand", "tracker_sim_number", "tracker_paired_at"],
          new_value: { tracker_imei: input.trackerImei, tracker_brand: input.trackerBrand },
          reason: resend ? "tracker_pairing_resend" : "tracker_pairing",
          request_id: req.requestId,
          endpoint: req.path,
          http_method: req.method,
        });

        return {
          status: 200,
          body: {
            success: true,
            message,
            smsCommand,
            simNumber: input.trackerSimNumber ?? null,
            vehiclePlate: vehicle.license_plate,
          },
          resourceId: input.vehicleId,
        } as never;
      }),
    ),
  );

  // ── Provisioning inbox: has each paired tracker phoned home? ────────────────────────────────
  router.get(
    "/pending",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("asset:read")),
    asyncHandler((req, res) => {
      const principal = (req as { principal?: Principal }).principal as Principal;
      return withTenantClient(pool, tenantContextOf(principal), async (client) => {
        const result = await client.query<{
          license_plate: string;
          tracker_imei: string;
          tracker_brand: string | null;
          tracker_paired_at: string | null;
          last_ping: string | null;
        }>(
          `SELECT v.license_plate,
                  v.tracker_imei,
                  v.tracker_brand,
                  v.tracker_paired_at,
                  -- v.tracker_last_ping_at is stamped on every accepted position, so it is the
                  -- authoritative liveness marker. Reading telemetry.location_updates here instead
                  -- would run a correlated max() per vehicle over a monthly-partitioned table with
                  -- no recorded_at bound, defeating partition pruning.
                  v.tracker_last_ping_at AS last_ping
              FROM app.vehicles v
             WHERE v.tenant_id = $1 AND v.tracker_imei IS NOT NULL AND v.deleted_at IS NULL
               -- Bound the scan (F9): only trackers with recent pairing or liveness, so the
               -- planner never seq-scans the whole fleet (both columns indexed).
               AND (v.tracker_paired_at > now() - interval '90 days'
                    OR v.tracker_last_ping_at > now() - interval '90 days')
            ORDER BY v.tracker_paired_at DESC NULLS LAST
            LIMIT 500`,
        );

        const now = new Date();
        const trackers: HardwareTrackerStatus[] = result.rows.map((row) => ({
          vehiclePlate: row.license_plate,
          imei: row.tracker_imei,
          brand: row.tracker_brand,
          pairedAt: row.tracker_paired_at ? new Date(row.tracker_paired_at).toISOString() : null,
          lastPing: row.last_ping ? new Date(row.last_ping).toISOString() : null,
          status: getStatus(row.last_ping, now),
        }));

        res.status(200).json({ trackers });
      });
    }),
  );

  return router;
}
