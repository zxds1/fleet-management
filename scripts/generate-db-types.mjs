// scripts/generate-db-types.mjs
// Generates packages/shared/src/types/db.ts from the LIVE applied schema
// (00-overview.md §5, 06-repository-migrations.md §7). The DDL in db/schema is the
// authority for table shape; TypeScript row types are generated, never hand-maintained.
//
//   node scripts/generate-db-types.mjs            # write the file
//   node scripts/generate-db-types.mjs --check    # fail if the committed file is stale
//
// Connection: DATABASE_URL / PGURI (default postgresql://postgres:pg_local_dev@localhost:5444/fleet)

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "packages", "shared", "src", "types", "db.ts");
const CHECK = process.argv.includes("--check");
const CONN =
  process.env.DATABASE_URL ?? process.env.PGURI ?? "postgresql://postgres:pg_local_dev@localhost:5444/fleet";

const SCHEMAS = ["app", "telemetry", "audit"];

/** snake_case -> PascalCase */
const pascal = (s) =>
  s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");

/** Naive, deterministic singularisation for row-type names (shifts -> Shift). */
function singular(name) {
  if (/ies$/.test(name)) return name.replace(/ies$/, "y");
  if (/(xes|zes|ches|shes)$/.test(name)) return name.replace(/es$/, "");
  if (/[^s]s$/.test(name) || /ses$/.test(name)) return name.replace(/s$/, "");
  return name;
}

const rowTypeName = (table) => `${pascal(singular(table))}Row`;
const viewTypeName = (view) => `${pascal(view.replace(/^v_/, ""))}ViewRow`;

/** pg type -> TypeScript type. numeric/bigint stay strings: that is what node-pg returns. */
function tsType(col, enumNames) {
  const t = col.udt_name;
  if (enumNames.has(t)) return pascal(t);
  switch (t) {
    case "bool":
      return "boolean";
    case "int2":
    case "int4":
    case "float4":
    case "float8":
      return "number";
    case "int8":
    case "numeric":
    case "money":
      return "string"; // node-pg returns bigint/numeric as string to avoid precision loss (D2)
    case "uuid":
    case "text":
    case "citext":
    case "varchar":
    case "bpchar":
    case "name":
    case "date":
    case "time":
    case "timetz":
    case "timestamp":
    case "timestamptz":
    case "interval":
    case "inet":
    case "cidr":
    case "geography":
    case "geometry":
    case "phone_e164":
      return "string";
    case "bytea":
      return "Buffer";
    case "json":
    case "jsonb":
      return "unknown";
    case "_text":
    case "_varchar":
    case "_uuid":
      return "string[]";
    case "_int2":
    case "_int4":
    case "_int8":
      return "number[]";
    default:
      if (t.startsWith("_")) {
        const inner = tsType({ udt_name: t.slice(1) }, enumNames);
        return `${inner}[]`;
      }
      return "unknown";
  }
}

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();

  const enums = (
    await client.query(
      `SELECT t.typname AS name,
              array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = ANY($1)
        GROUP BY t.typname
        ORDER BY t.typname`,
      [SCHEMAS],
    )
  ).rows;
  const enumNames = new Set(enums.map((e) => e.name));

  const relations = (
    await client.query(
      `SELECT c.relnamespace::regnamespace::text AS schema,
              c.relname AS name,
              c.relkind AS kind
         FROM pg_class c
        WHERE c.relnamespace::regnamespace::text = ANY($1)
          AND c.relkind IN ('r','p','v','m')
          AND c.relispartition = false
        ORDER BY 1, 2`,
      [SCHEMAS],
    )
  ).rows;

  const columns = (
    await client.query(
      `SELECT table_schema, table_name, column_name, udt_name, is_nullable, ordinal_position
         FROM information_schema.columns
        WHERE table_schema = ANY($1)
        ORDER BY table_schema, table_name, ordinal_position`,
      [SCHEMAS],
    )
  ).rows;

  const permissions = (await client.query(`SELECT code FROM app.permissions ORDER BY code`)).rows;

  await client.end();

  const byRelation = new Map();
  for (const c of columns) {
    const key = `${c.table_schema}.${c.table_name}`;
    if (!byRelation.has(key)) byRelation.set(key, []);
    byRelation.get(key).push(c);
  }

  const out = [];
  out.push("// packages/shared/src/types/db.ts");
  out.push("// GENERATED FILE — do not edit by hand.");
  out.push("// Source: the applied DDL in db/schema (00-overview.md §5, 06 §7).");
  out.push("// Regenerate with:  npm run db:types      Verify with:  npm run db:types:check");
  out.push("");
  out.push("/* eslint-disable */");
  out.push("");
  out.push("// ---------------------------------------------------------------- enums");
  for (const e of enums) {
    out.push(`export type ${pascal(e.name)} =`);
    out.push(e.labels.map((l) => `  | "${l}"`).join("\n") + ";");
    out.push("");
  }

  out.push("// ------------------------------------------------- permission codes (N4)");
  out.push("// Generated from app.permissions so a missing grant is a compile error (02 §5).");
  out.push("export type PermissionCode =");
  out.push(permissions.map((p) => `  | "${p.code}"`).join("\n") + ";");
  out.push("");
  out.push("export const PERMISSION_CODES: readonly PermissionCode[] = [");
  out.push(permissions.map((p) => `  "${p.code}",`).join("\n"));
  out.push("] as const;");
  out.push("");

  out.push("// ----------------------------------------------------------- row types");
  for (const rel of relations) {
    const cols = byRelation.get(`${rel.schema}.${rel.name}`) ?? [];
    if (cols.length === 0) continue;
    const isView = rel.kind === "v" || rel.kind === "m";
    const typeName = isView ? viewTypeName(rel.name) : rowTypeName(rel.name);
    out.push(`/** ${rel.schema}.${rel.name} */`);
    out.push(`export interface ${typeName} {`);
    for (const c of cols) {
      const nullable = c.is_nullable === "YES" ? " | null" : "";
      out.push(`  ${c.column_name}: ${tsType(c, enumNames)}${nullable};`);
    }
    out.push("}");
    out.push("");
  }

  const content = out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";

  if (CHECK) {
    const current = readFileSync(OUT, "utf8");
    if (current !== content) {
      console.error(
        "db.ts is out of date with the live schema. Run `npm run db:types` and commit the result.",
      );
      process.exit(1);
    }
    console.log("db.ts matches the live schema.");
    return;
  }

  writeFileSync(OUT, content, "utf8");
  console.log(`wrote ${path.relative(ROOT, OUT)} (${enums.length} enums, ${relations.length} relations)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
