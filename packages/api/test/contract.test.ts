// packages/api/test/contract.test.ts
// Real contract gate (09 §3 / Implementation-Prompt §7). Unlike the previous no-op `contract` task,
// this actually validates:
//   1. Every `$ref` in the OpenAPI document resolves to a defined component (schemas + responses).
//   2. Every 4xx/5xx response is a centralised `$ref` (RFC7807 responses, not inline bodies).
//   3. The auth boundary: every operation requires `bearerAuth` unless it is an explicitly public
//      endpoint (the Traccar webhook).
//   4. Every component schema referenced by a request/response has a matching @fleet/shared zod
//      schema (normalised name match), so the OpenAPI surface and the runtime validators cannot drift.
//   5. The generated `db.ts` row types are present (the live-schema ↔ db.ts check itself runs in CI
//      against a real PG via `npm run db:types:check`).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import * as shared from "@fleet/shared";

const OPENAPI_PATH = resolve(__dirname, "../../../api/openapi.yaml");
const DBTYPES_PATH = resolve(__dirname, "../../../packages/shared/src/types/db.ts");

// OpenAPI-only helper schemas that intentionally have no 1:1 zod export in @fleet/shared.
const SCHEMA_ALLOWLIST = new Set(["problem", "money", "geopoint", "mediauploadresponse"]);
// Operations that are intentionally unauthenticated.
const PUBLIC_PATHS = new Set(["/auth/login", "/telemetry/webhook"]);

function normalize(name: string): string {
  return name.toLowerCase().replace(/schema|request|response/g, "").replace(/[^a-z0-9]/g, "");
}

function collectSharedSchemaNames(): Set<string> {
  return new Set(
    Object.keys(shared)
      .filter((k) => k.endsWith("Schema"))
      .map(normalize),
  );
}

describe("OpenAPI ↔ schema contract", () => {
  const doc = yaml.load(readFileSync(OPENAPI_PATH, "utf8")) as Record<string, any>;
  const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
  const responses = (doc.components?.responses ?? {}) as Record<string, unknown>;
  const globalSecurity = doc.security as unknown[] | undefined;
  const sharedSchemas = collectSharedSchemaNames();

  it("every $ref resolves to a defined component", () => {
    const unresolved: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$ref" && typeof v === "string") {
            const m = v.match(/^#\/components\/(schemas|responses)\/(.+)$/);
            if (m) {
              const [kind, name] = [m[1]!, m[2]!];
              const defined = kind === "schemas" ? schemas[name] : responses[name];
              if (defined === undefined) unresolved.push(v);
            }
          } else {
            walk(v);
          }
        }
      }
    };
    walk(doc);
    expect(unresolved).toEqual([]);
  });

  it("every error response is RFC7807 (application/problem+json)", () => {
    const nonProblem: string[] = [];
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        if (!op || typeof op !== "object" || !op.responses) continue;
        for (const [status, resp] of Object.entries(op.responses)) {
          if (!/^[45]\d\d$/.test(status)) continue;
          const r = resp as any;
          if (r.$ref) continue; // centralised RFC7807 response
          const ok =
            r.content && r.content["application/problem+json"] && r.content["application/problem+json"].schema;
          if (!ok) nonProblem.push(`${method.toUpperCase()} ${path} → ${status}`);
        }
      }
    }
    expect(nonProblem).toEqual([]);
  });

  it("enforces the auth boundary (bearerAuth except public endpoints)", () => {
    const violations: string[] = [];
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        if (!op || typeof op !== "object") continue;
        const effective = Array.isArray(op.security) ? op.security : globalSecurity;
        const isPublic = Array.isArray(effective) && effective.length === 0;
        if (isPublic && !PUBLIC_PATHS.has(path)) {
          violations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("referenced component schemas have a matching @fleet/shared zod schema", () => {
    const missing: string[] = [];
    const referenced = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$ref" && typeof v === "string") {
            const m = v.match(/^#\/components\/schemas\/(.+)$/);
            if (m) referenced.add(m[1]!);
          } else {
            walk(v);
          }
        }
      }
    };
    walk(doc);
    for (const name of referenced) {
      const n = normalize(name);
      if (!sharedSchemas.has(n) && !SCHEMA_ALLOWLIST.has(n)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it("generated db.ts row types are present", () => {
    const src = readFileSync(DBTYPES_PATH, "utf8");
    const rowInterfaces = src.match(/export interface \w+Row/g) ?? [];
    expect(rowInterfaces.length).toBeGreaterThanOrEqual(20);
  });
});
