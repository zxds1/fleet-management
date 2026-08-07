// db/validate.mjs
// Cross-platform schema validation harness (mirror of db/validate.sh for Windows
// dev boxes without bash). Applies db/schema/*.sql then db/seed/*.sql to the
// target cluster and runs the post-apply smoke checks.
//
// POSTGIS=shim installs db/validate-postgis-shim.sql and, because the shim's
// `geography` is a DOMAIN (which cannot carry a type modifier), rewrites
// `geography(Point, 4326)` -> `geography` in a TEMPORARY COPY of each schema
// file. The shipped DDL in db/schema is never modified.
//
// Usage:
//   PGURI=postgresql://postgres:pg_local_dev@localhost:5444/fleet POSTGIS=shim node db/validate.mjs
//   PSQL_BIN=C:\path\to\psql.exe node db/validate.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const PSQL = process.env.PSQL_BIN ?? "psql";
const PGURI = process.env.PGURI ?? "postgresql://postgres:pg_local_dev@localhost:5444/fleet";
const POSTGIS_MODE = process.env.POSTGIS ?? "real";

const SCHEMA_FILES = [
  "00_extensions.sql",
  "01_enums.sql",
  "02_identity.sql",
  "03_platform_core.sql",
  "04_assets.sql",
  "05_operations.sql",
  "06_telemetry_hos.sql",
  "07_financial.sql",
  "08_safety.sql",
  "09_audit_notifications.sql",
  "10_partitions.sql",
  "11_views.sql",
];

/** Run psql against `uri`, returning stdout. Throws with stderr on failure. */
function psql(uri, args) {
  const res = spawnSync(PSQL, ["-d", uri, "--no-psqlrc", "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`psql failed (${res.status})\n${res.stdout ?? ""}\n${res.stderr ?? ""}`);
  }
  return res.stdout ?? "";
}

function adminUri() {
  const u = new URL(PGURI);
  u.pathname = "/postgres";
  return u.toString();
}

function databaseName() {
  return new URL(PGURI).pathname.replace(/^\//, "") || "fleet";
}

/** The shim geography is a DOMAIN; strip PostGIS type modifiers for local validation only. */
function shimRewrite(sql) {
  return sql.replace(/\bgeography\s*\(\s*(Point|Polygon|LineString|MultiPolygon)\s*,\s*\d+\s*\)/gi, "geography");
}

function main() {
  const db = databaseName();
  console.log(`==> Target ${PGURI.replace(/:[^:@/]*@/, ":***@")}  (POSTGIS=${POSTGIS_MODE})`);

  console.log("==> Ensuring database exists");
  const exists = psql(adminUri(), ["-t", "-A", "-c", `SELECT 1 FROM pg_database WHERE datname='${db}'`]).trim();
  if (exists !== "1") psql(adminUri(), ["-c", `CREATE DATABASE ${db}`]);

  let workDir = null;
  if (POSTGIS_MODE === "shim") {
    console.log("==> Installing local PostGIS shim (validation only)");
    psql(PGURI, ["-f", path.join("db", "validate-postgis-shim.sql")]);
    workDir = mkdtempSync(path.join(tmpdir(), "fleet-schema-"));
  }

  console.log("==> Applying schema");
  for (const file of SCHEMA_FILES) {
    const src = path.join(ROOT, "db", "schema", file);
    let target = src;
    if (workDir) {
      target = path.join(workDir, file);
      writeFileSync(target, shimRewrite(readFileSync(src, "utf8")), "utf8");
    }
    console.log(`  - db/schema/${file}`);
    psql(PGURI, ["-f", target]);
  }

  console.log("==> Applying seed");
  psql(PGURI, ["-f", path.join("db", "seed", "01_seed.sql")]);

  console.log("==> Post-apply smoke checks");
  const smoke = psql(PGURI, [
    "-t",
    "-A",
    "-F",
    "|",
    "-c",
    `SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='telemetry' AND c.relname ~ '^location_updates_y') AS location_partitions,
            (SELECT count(*) FROM app.roles)         AS roles,
            (SELECT count(*) FROM app.permissions)   AS permissions,
            (SELECT count(*) FROM app.system_config) AS config_rows,
            (SELECT count(*) FROM app.hos_policies)  AS hos_policies,
            (SELECT count(*) FROM app.v_vehicle_display_state) AS display_states`,
  ]).trim();
  console.log(
    `  location_partitions|roles|permissions|config_rows|hos_policies|display_states = ${smoke}`,
  );

  if (workDir) rmSync(workDir, { recursive: true, force: true });
  console.log(`==> Schema validation PASSED (POSTGIS=${POSTGIS_MODE})`);
}

main();
