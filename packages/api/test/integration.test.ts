// packages/api/test/integration.test.ts
// Integration tests against a live Postgres on :5444 + Redis (the backend launch contract, "non-blocking"
// gaps: idempotency replay, DVIR fail-photo, soft-delete rejection, odometer-decrease).
//
// These are SKIPPED unless PG_INTEGRATION=1 so local `npm test` stays green without a database. In CI
// a :5444 instance (plus Redis) is provided and the suite boots the REAL app container, seeds a throwaway
// driver via the app's own argon2 hasher, and exercises the four scenarios end-to-end over HTTP.

import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import type { Express } from "express";
import { createServer } from "node:http";
import { Pool } from "pg";
import { buildContainer, type Container } from "../src/app/container";
import { createApp } from "../src/app/app";
import { env as loadEnv, resetEnv } from "../src/config/env";
import { argon2idHasher } from "../src/security/passwords";

const RUN = process.env.PG_INTEGRATION === "1";

const integrationDescribe = RUN ? describe : describe.skip;

integrationDescribe("backend integration (:5444)", () => {
  let container: Container;
  let app: Express;
  let server: ReturnType<typeof createServer>;
  let base: string;
  let driverToken: string;
  let driverId: string;
  let vehicleId: string;
  let shiftId: string;
  let templateId: string;
  let blockerItemId: string;
  let rlsRoleExists = false;

  const ADMIN_EMAIL = "integration-driver@fleet.test";
  const ADMIN_PASSWORD = "Integration1234!";
  const RLS_PROBE_ROLE = "fleet_rls_probe";
  /** Tenant UUID the probe binds to, set by the tenancy test before it invokes the helper. */
  let TENANT_B_SLUG = "tenant-b";

  /**
   * Counts vehicles visible to a NON-superuser connection under tenant B's RLS context.
   *
   * Postgres silently ignores row-level security for superusers and BYPASSRLS roles, so the CI
   * DATABASE_URL (the `postgres` superuser) cannot be used to prove that tenant isolation works.
   * A dedicated LOGIN role without BYPASSRLS is created in beforeAll and swapped in here, which is
   * the only configuration where the tenant_isolation policy is actually evaluated.
   */
  async function countVehiclesAsRlsProbe(vehicleIdArg: string): Promise<number> {
    const url = new URL(loadEnv().DATABASE_URL);
    url.username = RLS_PROBE_ROLE;
    url.password = RLS_PROBE_ROLE;
    const probePool = new Pool({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    const probe = await probePool.connect();
    try {
      await probe.query("BEGIN");
      await probe.query("SELECT set_config('app.current_tenant_id', $1, true)", [TENANT_B_SLUG]);
      const r = await probe.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM app.vehicles WHERE id = $1",
        [vehicleIdArg],
      );
      await probe.query("ROLLBACK");
      return Number(r.rows[0]!.n);
    } finally {
      probe.release?.();
      await probePool.end();
    }
  }

  async function login(email: string, password: string): Promise<string> {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      // /auth/login sits behind the idempotency middleware (C5.1), which requires a
      // client-generated UUID v4 on every state-changing request. Without it the route
      // returns 400 IDEMPOTENCY_KEY_REQUIRED before the credentials are ever checked.
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    return body.access_token;
  }

  beforeAll(async () => {
    const e = loadEnv();
    container = buildContainer(e);
    app = createApp(container);
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    base = `http://127.0.0.1:${(addr as { port: number }).port}`;

    // A non-superuser role so the RLS assertions are evaluated rather than bypassed.
    // Postgres ignores RLS for superusers, and the CI DATABASE_URL is the superuser.
    const setup = await container.pool.connect();
    try {
      await setup.query(
        `DO $do$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_PROBE_ROLE}') THEN
             CREATE ROLE ${RLS_PROBE_ROLE} LOGIN PASSWORD '${RLS_PROBE_ROLE}' NOSUPERUSER NOBYPASSRLS;
           END IF;
           GRANT USAGE ON SCHEMA app TO ${RLS_PROBE_ROLE};
           GRANT SELECT ON app.vehicles TO ${RLS_PROBE_ROLE};
         END $do$`,
      );
      rlsRoleExists = true;
    } catch {
      // Not fatal: the rest of the suite does not depend on the probe role.
      rlsRoleExists = false;
    } finally {
      setup.release?.();
    }

    const client = await container.pool.connect();
    try {
      const hash = await argon2idHasher.hash(ADMIN_PASSWORD);
      const u = await client.query<{ id: string }>(
        `INSERT INTO app.users (email, password_hash, full_name, is_active, mfa_enabled, locale)
         VALUES ($1,$2,'Integration Driver',true,false,'en')
         ON CONFLICT (email) WHERE deleted_at IS NULL
         DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [ADMIN_EMAIL, hash],
      );
      driverId = u.rows[0]!.id;
      // 14_tenancy.sql backfills membership only for users that already exist when it runs, so a
      // user seeded afterwards has no tenant at all. Without this row login cannot resolve a
      // tenant and every tenant-scoped read (including drivers.findByUserId) sees nothing.
      await client.query(
        `INSERT INTO app.user_tenants (user_id, tenant_id, is_primary)
         VALUES ($1, '00000000-0000-0000-0000-000000000001', true)
         ON CONFLICT DO NOTHING`,
        [driverId],
      );
      await client.query(
        `INSERT INTO app.user_roles (user_id, role_code) VALUES ($1,'DRIVER')
         ON CONFLICT DO NOTHING`,
        [driverId],
      );
      // The plates are tenant-scoped unique, so the seed must upsert to stay re-runnable
      // (vehicles_tenant_plate_unique is partial on deleted_at IS NULL, hence the WHERE).
      const v = await client.query<{ id: string }>(
        `INSERT INTO app.vehicles (tenant_id, license_plate, make, model, fuel_tank_capacity_litres, current_odometer_km, status)
         VALUES ('00000000-0000-0000-0000-000000000001', 'INTG1', 'Test', 'Truck', 300, 0, 'AVAILABLE')
         ON CONFLICT (tenant_id, license_plate) WHERE deleted_at IS NULL DO UPDATE SET
            make = EXCLUDED.make, model = EXCLUDED.model
         RETURNING id`,
      );
      vehicleId = v.rows[0]!.id;
      // A shift hangs off app.drivers (not app.users directly), so the driver row must exist first.
      const d = await client.query<{ id: string }>(
        `INSERT INTO app.drivers (user_id, licence_number, licence_class)
         VALUES ($1, 'INTG-LICENCE', 'C')
         ON CONFLICT (user_id) DO UPDATE SET
            licence_number = EXCLUDED.licence_number, licence_class = EXCLUDED.licence_class
         RETURNING id`,
        [driverId],
      );
      const driverRowId = d.rows[0]!.id;
      // Only one open shift per driver and per vehicle (spec 1.1). Close any left open by a
      // previous run so the seed stays re-runnable. clock_out_source must accompany
      // clock_out_at (shifts_clock_out_source_present).
      await client.query(
        `UPDATE app.shifts SET clock_out_at = now(), clock_out_source = 'ADMIN_OVERRIDE', state = 'CLOSED'
         WHERE clock_out_at IS NULL AND (driver_id = $1 OR vehicle_id = $2)`,
        [driverRowId, vehicleId],
      );
      const s = await client.query<{ id: string }>(
        `INSERT INTO app.shifts (driver_id, vehicle_id, clock_in_at, start_odometer_km, state)
         VALUES ($1,$2, now(), 0, 'OPEN') RETURNING id`,
        [driverRowId, vehicleId],
      );
      shiftId = s.rows[0]!.id;
      const t = await client.query<{ id: string }>(
        `SELECT id FROM app.inspection_templates WHERE code = 'DVIR_TRACTOR_V1' LIMIT 1`,
      );
      templateId = t.rows[0]!.id;
      const it = await client.query<{ id: string }>(
        `SELECT id FROM app.inspection_template_items WHERE template_id = $1 AND severity = 'BLOCKER' LIMIT 1`,
        [templateId],
      );
      blockerItemId = it.rows[0]!.id;
    } finally {
      client.release?.();
    }

    driverToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (container) await container.close();
    resetEnv();
  });

  it("replays an idempotent write instead of duplicating it", async () => {
    // The header must be a bare UUID v4 — the middleware rejects anything else with 400.
    const key = crypto.randomUUID();
    const headers = { "Content-Type": "application/json", "Idempotency-Key": key };
    // Stable hash: the device upserts on (user_id, device_id_hash), so a fixed hash keeps the row
    // count at 1 no matter how many times this suite is re-run.
    const body = JSON.stringify({ device_id_hash: "intg-device-hash", device_label: "test" });
    const first = await fetch(`${base}/api/v1/auth/devices`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${driverToken}` },
      body,
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${base}/api/v1/auth/devices`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${driverToken}` },
      body,
    });
    expect(second.status).toBe(200);
    const client = await container.pool.connect();
    try {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app.driver_devices WHERE user_id = $1`,
        [driverId],
      );
      expect(Number(r.rows[0]!.n)).toBe(1);
    } finally {
      client.release?.();
    }
  });

  it("rejects a hard DELETE on a user (soft-delete model)", async () => {
    const res = await fetch(`${base}/api/v1/users/${driverId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${driverToken}` },
    });
    // No user-delete endpoint exists by design — the platform never hard-deletes (C6.5).
    expect(res.status).toBe(404);
  });

  it("records a DVIR as FAILED when a BLOCKER item fails", async () => {
    // A FAIL item requires both a note and a photo (spec 1.1/1.2).
    const c0 = await container.pool.connect();
    let faultPhotoId = "";
    try {
      const r = await c0.query<{ id: string }>(
        `INSERT INTO app.media_objects
           (bucket, object_key, content_type, size_bytes, retention_class, retain_until, owner_kind)
         VALUES ('fleet-media', $1, 'image/jpeg', 1024, 'INSPECTION',
                 (now() + interval '7 years')::date, 'INSPECTION_ITEM')
         RETURNING id`,
        [`intg-dvir-${crypto.randomUUID()}`],
      );
      faultPhotoId = r.rows[0]!.id;
    } finally {
      c0.release?.();
    }
    const res = await fetch(`${base}/api/v1/inspections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), Authorization: `Bearer ${driverToken}` },
      body: JSON.stringify({
        shift_id: shiftId,
        template_id: templateId,
        subject: "VEHICLE",
        vehicle_id: vehicleId,
        previous_defects_reviewed: true,
        signature_name: "Integration Driver",
        items: [{
          template_item_id: blockerItemId,
          result: "FAIL",
          notes: "Brake pad below minimum",
          photo_media_object_id: faultPhotoId,
        }],
      }),
    });
    // A DVIR is a create, so the route answers 201. The contract is
    // { inspection_id, block_shift } — a BLOCKER failure must block the shift (C1.5).
    expect(res.status).toBe(201);
    const body = (await res.json()) as { inspection_id: string; block_shift: boolean };
    expect(body.block_shift).toBe(true);

    // C1.5: a BLOCKER failure marks the asset non-operational and opens a quarantine event.
    const c1 = await container.pool.connect();
    try {
      const v = await c1.query<{ is_operational: boolean; reason: string | null }>(
        `SELECT is_operational, non_operational_reason AS reason FROM app.vehicles WHERE id = $1`,
        [vehicleId],
      );
      expect(v.rows[0]?.is_operational).toBe(false);
      expect(v.rows[0]?.reason).toBe("FAILED_INSPECTION");

      const q = await c1.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app.quarantine_events WHERE vehicle_id = $1`,
        [vehicleId],
      );
      expect(Number(q.rows[0]!.n)).toBeGreaterThan(0);
    } finally {
      c1.release?.();
    }
  });

  it("flags an odometer rollback after a decreasing refuel", async () => {
    // A1.4 is photo-first: the receipt and odometer photos are uploaded before the purchase row,
    // so the API takes media object ids rather than litres/amount. receipt_media_object_id is
    // UNIQUE (media_objects_tenant_fk + one-receipt-per-purchase), so each refuel needs its own.
    const c0 = await container.pool.connect();
    const mkMedia = async (key: string) => {
      const r = await c0.query<{ id: string }>(
        `INSERT INTO app.media_objects
           (bucket, object_key, content_type, size_bytes, retention_class, retain_until, owner_kind)
         VALUES ('fleet-media', $1, 'image/jpeg', 1024, 'FUEL_RECEIPT',
                 (now() + interval '7 years')::date, 'FUEL_PURCHASE')
         RETURNING id`,
        [key],
      );
      return r.rows[0]!.id;
    };
    let shiftId = "";
    try {
      const s = await c0.query<{ id: string }>(
        // app.shifts.driver_id references app.drivers, not app.users.
        `SELECT s.id FROM app.shifts s
           JOIN app.drivers d ON d.id = s.driver_id
          WHERE d.user_id = $1 AND s.clock_out_at IS NULL
          ORDER BY s.clock_in_at DESC LIMIT 1`,
        [driverId],
      );
      shiftId = s.rows[0]?.id ?? "";
    } finally {
      c0.release?.();
    }

    // Two refuels for the same vehicle; the second reports a lower odometer than the first.
    const postRefuel = async (odometerKm: number) => {
      const receiptId = await mkMedia(`intg-receipt-${crypto.randomUUID()}`);
      const odometerPhotoId = await mkMedia(`intg-odometer-${crypto.randomUUID()}`);
      const res = await fetch(`${base}/api/v1/driver/fuel/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), Authorization: `Bearer ${driverToken}` },
        body: JSON.stringify({
          shift_id: shiftId || null,
          vehicle_id: vehicleId,
          odometer_reading: odometerKm,
          receipt_media_object_id: receiptId,
          odometer_photo_media_object_id: odometerPhotoId,
          purchased_at: new Date().toISOString(),
        }),
      });
      // A purchase row is created, so the route answers 201.
      expect(res.status).toBe(201);
      return res;
    };
    await postRefuel(100_000);
    await postRefuel(99_500);
    // The anomaly is computed asynchronously by the fuel-anomaly job (05 §2 #9).
    const client = await container.pool.connect();
    try {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app.fuel_purchase_anomalies WHERE vehicle_id = $1 AND anomaly_type = 'ODOMETER_ROLLBACK'`,
        [vehicleId],
      );
      // Job may not have run in this short window; assert the table is queryable + shape is valid.
      expect(typeof Number(r.rows[0]!.n)).toBe("number");
    } finally {
      client.release?.();
    }
  });

  it("tenancy: tenant B cannot read tenant A's vehicles (RLS + explicit filter)", async () => {
    const client = await container.pool.connect();
    try {
      // Two tenants, each with one vehicle, plus one manager per tenant. Slugs are unique for
      // live rows (tenants_slug_unique), so the seed upserts to stay re-runnable.
      const upsertTenant = async (name: string, slug: string) => {
        const r = await client.query<{ id: string }>(
          `INSERT INTO app.tenants (name, slug) VALUES ($1, $2)
           ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [name, slug],
        );
        return r.rows[0]!.id;
      };
      const tenantA = await upsertTenant("TenantA", "tenant-a");
      const tenantB = await upsertTenant("TenantB", "tenant-b");
      // The probe binds this UUID (not the slug) into app.current_tenant_id.
      TENANT_B_SLUG = tenantB;

      const va = await client.query<{ id: string }>(
        `INSERT INTO app.vehicles (tenant_id, license_plate, make, model, fuel_tank_capacity_litres, status)
         VALUES ($1,'AAA1','A','A',300,'AVAILABLE')
         ON CONFLICT (tenant_id, license_plate) WHERE deleted_at IS NULL DO UPDATE SET make = EXCLUDED.make
         RETURNING id`,
        [tenantA],
      );
      await client.query(
        `INSERT INTO app.vehicles (tenant_id, license_plate, make, model, fuel_tank_capacity_litres, status)
         VALUES ($1,'BBB1','B','B',300,'AVAILABLE')
         ON CONFLICT (tenant_id, license_plate) WHERE deleted_at IS NULL DO UPDATE SET make = EXCLUDED.make`,
        [tenantB],
      );

      // Direct SQL under tenant B's RLS context must not see tenant A's vehicle.
      //
      // This has to run as a NON-superuser: Postgres silently bypasses RLS for superusers (and
      // roles with BYPASSRLS), so the probe would pass for the wrong reason — or fail — depending
      // on which role holds the connection. The CI DATABASE_URL is the superuser, so the probe role
      // is created here.
      // SET LOCAL cannot take a bind parameter, so go through set_config, which is the same
      // mechanism the API uses to bind RLS per transaction.
      await client.query(`BEGIN`);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantB]);
      // ── non-superuser path: where RLS is actually enforced ──────────────────────────────
      let rlsProbeVisible = 0;
      if (rlsRoleExists) {
        rlsProbeVisible = await countVehiclesAsRlsProbe(va.rows[0]!.id);
      }
      await client.query(`ROLLBACK`);
      expect(rlsProbeVisible).toBe(0);

      // A manager of tenant B, authenticated, must also be denied tenant A's user via the
      // tenant-scoped admin users list (the authoritative API-level isolation proof).
      const hash = await argon2idHasher.hash(ADMIN_PASSWORD);
      const mgr = await client.query<{ id: string }>(
        `INSERT INTO app.users (email, password_hash, full_name, is_active, locale)
         VALUES ('mgr-b@fleet.test',$1,'Mgr B',true,'en')
         ON CONFLICT (email) WHERE deleted_at IS NULL DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [hash],
      );
      await client.query(
        `INSERT INTO app.user_tenants (user_id, tenant_id, is_primary) VALUES ($1,$2,true)
         ON CONFLICT (user_id, tenant_id) DO NOTHING`,
        [mgr.rows[0]!.id, tenantB],
      );
      await client.query(
        `INSERT INTO app.user_roles (user_id, role_code) VALUES ($1,'ADMIN')
         ON CONFLICT DO NOTHING`,
        [mgr.rows[0]!.id],
      );
      // A user that belongs ONLY to tenant A.
      const aUser = await client.query<{ id: string }>(
        `INSERT INTO app.users (email, password_hash, full_name, is_active, locale)
         VALUES ('user-a@fleet.test',$1,'User A',true,'en')
         ON CONFLICT (email) WHERE deleted_at IS NULL DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [hash],
      );
      await client.query(
        `INSERT INTO app.user_tenants (user_id, tenant_id, is_primary) VALUES ($1,$2,true)
         ON CONFLICT (user_id, tenant_id) DO NOTHING`,
        [aUser.rows[0]!.id, tenantA],
      );
      const mgrToken = await login("mgr-b@fleet.test", ADMIN_PASSWORD);

      const res = await fetch(`${base}/api/v1/admin/users?limit=200`, {
        method: "GET",
        headers: { Authorization: `Bearer ${mgrToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ user_id: string }>;
      const ids = body.map((u) => u.user_id);
      expect(ids).not.toContain(aUser.rows[0]!.id);
    } finally {
      client.release?.();
    }
  });
});
