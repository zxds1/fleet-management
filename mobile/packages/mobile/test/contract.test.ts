import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import * as S from '@fleet/shared';
import { ALL_ENDPOINTS, ENDPOINTS, url } from '../src/api/endpoints';
import { targetFromNotification } from '../src/push';

/**
 * CONTRACT TESTS, GENERATED FROM THE BACKEND SOURCE.
 *
 * The source of truth is the ROUTERS, not `openapi.yaml`: openapi.yaml is the locked copy of 02-api.md
 * and documents only part of the surface (it has no device registration, no onboarding, no
 * photo-first fuel, no media read), while the routers are what actually answer. So these tests read
 * `packages/api/src/http/routes/*.ts` and the mount table in `app.ts`, rebuild the real method+path
 * set, and check the app against THAT. `openapi.yaml` is still cross-checked wherever it does
 * document a path, so a drift between the doc and the router cannot pass unnoticed either.
 */
const BACKEND = resolveBackend();
const realRoutes = scanRoutes();
const openapi = parse(readFileSync(`${BACKEND}/api/openapi.yaml`, 'utf8')) as { paths: Record<string, Record<string, { parameters?: { name: string }[] }>> };
const id = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';

/** Walks up until it finds the backend package, so the path does not depend on the cwd. */
function resolveBackend(): string {
  const candidates = ['../api', '../../api', '../../../api', '../../../../fleet-management', '/home/bstudio/Projects/helix/fleet-management'];
  for (const c of candidates) { if (existsSync(`${c}/packages/api/src/app/app.ts`)) return c; }
  throw new Error('the backend package was not found; the contract tests cannot run');
}

/**
 * Rebuilds the real route table: every `router.<method>("/path"` in every route file, prefixed by the
 * mount point `app.use(`${base}/prefix`, createXRouter(...))` declares for it in `app/app.ts`.
 * Express path params (`:id`) become the openapi form (`{id}`). Returns `METHOD /path`.
 */
function scanRoutes(): Set<string> {
  const root = `${BACKEND}/packages/api/src/app`;
  const dir = `${BACKEND}/packages/api/src/http/routes`;
  const appSrc = readFileSync(`${root}/app.ts`, 'utf8');

  // factory name -> the file that defines it (the factory name and the filename do not always match).
  const factoryFile = new Map<string, string>();
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ts')) : []) {
    const src = readFileSync(`${dir}/${file}`, 'utf8');
    for (const m of src.matchAll(/export function (create\w*Router)\s*\(/g)) factoryFile.set(m[1]!, file);
  }

  const out = new Set<string>();
  const route = /router\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g;
  const mountRe = /app\.use\(\s*`\$\{base\}([^`]*)`\s*,\s*create(\w*)Router\(/g;
  for (const m of appSrc.matchAll(mountRe)) {
    const file = factoryFile.get(`create${m[2]!}Router`);
    if (!file) continue;
    const src = readFileSync(`${dir}/${file}`, 'utf8');
    for (const r of src.matchAll(route)) {
      const sub = r[2]!.replace(/:(\w+)/g, '{$1}');
      const prefix = m[1]!.replace(/\/$/, '');
      out.add(`${r[1]!.toUpperCase()} ${prefix}${sub === '/' ? '' : sub}` || '/');
    }
  }
  return out;
}

describe('contract: the real router table', () => {
  it('found the backend and rebuilt a plausible route set', () => {
    expect(BACKEND).toMatch(/fleet-management|^\.\.+$/);
    expect(realRoutes.size).toBeGreaterThan(60);
    expect(realRoutes.has('POST /shifts/clock-in')).toBe(true);
    expect(realRoutes.has('GET /dashboard/vehicle-states')).toBe(true);
  });

  it.each(ALL_ENDPOINTS.filter((e) => e.endpoint.status === 'CONTRACT').map((e) => [e.key, e.endpoint.method, e.endpoint.template] as const))(
    '%s -> %s %s is declared by a router',
    (key, method, template) => {
      expect(realRoutes.has(`${method} ${template}`), `${key}: ${method} ${template} is not declared by any router in packages/api/src/http/routes`).toBe(true);
    },
  );

  /**
   * Where openapi.yaml DOES document a path, the method and the path params must agree with the router.
   * openapi is a partial copy of 02-api.md, so a method it does not list is a SPEC GAP, not app drift:
   * the known gaps are asserted by name so they stay visible instead of silently passing (D-04).
   */
  it('where openapi documents a path, the method and params agree; the known spec gaps are unchanged', () => {
    const KNOWN_SPEC_GAPS = ['inspections: openapi does not list GET /inspections', 'createDriver: openapi does not list POST /drivers'];
    const mismatches: string[] = [];
    for (const { key, endpoint } of ALL_ENDPOINTS) {
      const ops = openapi.paths[endpoint.template];
      if (!ops) continue;   // openapi does not document this path at all
      const op = ops[endpoint.method.toLowerCase()];
      if (!op) { mismatches.push(`${key}: openapi does not list ${endpoint.method} ${endpoint.template}`); continue; }
      const declared = new Set((op.parameters ?? []).map((p) => p.name));
      for (const m of endpoint.template.matchAll(/\{(\w+)\}/g)) if (!declared.has(m[1]!)) mismatches.push(`${key}: {${m[1]}} is not declared in openapi`);
    }
    expect(mismatches.filter((m) => !KNOWN_SPEC_GAPS.includes(m))).toEqual([]);
    expect(mismatches.filter((m) => KNOWN_SPEC_GAPS.includes(m))).toEqual(KNOWN_SPEC_GAPS);
  });

  it('every endpoint the app calls is CONTRACT: nothing is guessed any more', () => {
    // U-12 retired the only guessed endpoint (`POST /fuel/refuel`) on the backend, so this list is empty.
    // The assertion above proves each one is declared by a real router, which is the stronger guarantee.
    expect(ALL_ENDPOINTS.filter((e) => e.endpoint.status !== 'CONTRACT')).toEqual([]);
  });

  it('url() fills and encodes, and refuses a missing parameter', () => {
    expect(url(ENDPOINTS.verifyShift, { id: 'abc' })).toBe('/shifts/abc/verify');
    expect(url(ENDPOINTS.accidentMedia, { id: 'a/b c' })).toBe('/accidents/a%2Fb%20c/media');
    expect(url(ENDPOINTS.login)).toBe('/auth/login');
    expect(() => url(ENDPOINTS.verifyShift)).toThrow(/Missing "id"/);
  });
});

/**
 * Regression guards for the backend defects found while closing the ledger. These read the backend source,
 * so if someone reintroduces the bug the suite fails rather than the app silently 403ing in the field.
 */
describe('contract: backend defects that were fixed, and must stay fixed', () => {
  const seed = readFileSync(`${BACKEND}/db/seed/01_seed.sql`, 'utf8');
  const permissionRows = new Set([...seed.matchAll(/\('([a-z_]+:[a-z_]+)',\s*'/g)].map((m) => m[1]!));
  const permissionUnionSrc = /export type PermissionCode =([\s\S]*?);/.exec(readFileSync(`${BACKEND}/packages/shared/src/types/db.ts`, 'utf8'))?.[1] ?? '';
  const union = [...permissionUnionSrc.matchAll(/"([a-z_]+:[a-z_]+)"/g)].map((m) => m[1]!);

  it('D-05: every PermissionCode has a row in app.permissions, or no role can ever hold it', () => {
    // app.role_permissions.permission_code has an FK to app.permissions(code), so a code with no row is
    // ungrantable and every route gated on it is a 403 for every role. This failed for 16 codes.
    expect(union.length).toBeGreaterThan(70);
    expect(union.filter((c) => !permissionRows.has(c))).toEqual([]);
  });

  it('D-05: a DRIVER holds the read halves of the flows it can already create', () => {
    const driver = /SELECT 'DRIVER', p FROM unnest\(ARRAY\[([\s\S]*?)\]\)/.exec(seed)?.[1] ?? '';
    for (const c of ['inspection:read', 'accident:read', 'notification:read', 'onboarding:read', 'onboarding:submit']) {
      expect(driver, `DRIVER must hold ${c}`).toContain(`'${c}'`);
    }
  });

  it('D-06: no requirePermission code is upper-case (it could never match a grant)', () => {
    const upper: string[] = [];
    for (const file of readdirSync(`${BACKEND}/packages/api/src/http/routes`).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(`${BACKEND}/packages/api/src/http/routes/${file}`, 'utf8');
      for (const m of src.matchAll(/asPerm\("([A-Z_]+)"\)/g)) upper.push(`${file}: ${m[1]}`);
    }
    expect(upper).toEqual([]);
  });

  it('D-07: GET /inspections/templates returns the checklist items, not just the template', () => {
    const src = readFileSync(`${BACKEND}/packages/api/src/repositories/inspections.ts`, 'utf8');
    const list = /async listActive\(\)[\s\S]*?\n  \}/.exec(src)?.[0] ?? '';
    for (const col of ['label_en', 'label_sw', 'severity', 'input_type', 'unit', 'min_value', 'max_value', 'is_required', 'sequence']) {
      expect(list, `listActive() must select ${col} so a driver can render the checklist`).toContain(col);
    }
    // A driver must still hold the permission the route enforces.
    expect(permissionRows.has('inspection:read')).toBe(true);
  });

  it('D-07: the app schema rejects a template with no items, so a broken server cannot silently pass', () => {
    const t = { template_id: id, name: 'Pre-Shift', label: 'Pre-Shift', subject: 'VEHICLE' };
    expect(S.InspectionTemplatesResponseSchema.safeParse({ templates: [{ ...t, items: [] }] }).success).toBe(true);
    expect(S.InspectionTemplatesResponseSchema.safeParse({ templates: [t] }).success).toBe(true);   // items default to []
    expect(S.InspectionTemplatesResponseSchema.safeParse({ templates: [{ ...t, items: [{ template_item_id: id }] }] }).success).toBe(false);
  });

  it('D-09: the webhook HMAC guards ONLY /telemetry/webhook, never the phone-GPS ingest', () => {
    // webhookAuth demands x-signature + x-timestamp over the raw body, and fails CLOSED (401 for
    // everyone) when WEBHOOK_SECRET is unset while SECURITY_ENFORCE is on. Mounted on the
    // `/telemetry` PREFIX it also covered POST /telemetry/points (U-01), which the app
    // authenticates with a bearer token and cannot sign — so phone tracking was dead in production.
    const appSrc = readFileSync(`${BACKEND}/packages/api/src/app/app.ts`, 'utf8');
    const guards = [...appSrc.matchAll(/app\.\w+\(\s*(`[^`]*`)\s*,\s*webhookAuth\(/g)].map((m) => m[1]!);
    expect(guards).toEqual(['`${base}/telemetry/webhook`']);
  });
});

describe('contract: the checklist item contract', () => {
  const item = { template_item_id: id, code: 'REEFER_TEMP', label_en: 'Reefer temperature', label_sw: 'Joto la jokofu', severity: 'WARNING', input_type: 'NUMERIC', unit: 'C', min_value: -40, max_value: 40, is_required: false, sequence: 6 };
  it('a NUMERIC item carries its own unit and bounds, and both languages', () => {
    expect(S.InspectionTemplateItemOptionSchema.parse(item).input_type).toBe('NUMERIC');
    expect(S.InspectionTemplateItemOptionSchema.safeParse({ ...item, severity: 'INFO' }).success).toBe(false);
    expect(S.InspectionTemplateItemOptionSchema.safeParse({ ...item, input_type: 'TEXT' }).success).toBe(false);
  });
  it('a PASS_FAIL item has no bounds, which is what the DB CHECK enforces', () => {
    const pf = { ...item, code: 'TIRES', label_en: 'Tyres', label_sw: 'Tire', severity: 'BLOCKER', input_type: 'PASS_FAIL', unit: null, min_value: null, max_value: null, is_required: true };
    expect(S.InspectionTemplateItemOptionSchema.parse(pf).severity).toBe('BLOCKER');
  });
  it('a NUMERIC reading rides on the submit item as numeric_value', () => {
    expect(S.InspectionItemSchema.parse({ template_item_id: id, result: 'PASS', numeric_value: 3.5 }).numeric_value).toBe(3.5);
    expect(S.InspectionItemSchema.safeParse({ template_item_id: id, result: 'PASS', numeric_value: 'cold' }).success).toBe(false);
  });
});

describe('contract: the requests the app sends parse against the real schemas', () => {
  it('clock-in / clock-out', () => {
    expect(S.ClockInSchema.parse({ assignment_id: id, start_odometer_km: 12345, start_fuel_gauge: 'HALF', start_media_object_id: id, phone_gps_fallback_enabled: false, consent_version: '2026-01-01' }).start_fuel_gauge).toBe('HALF');
    expect(() => S.ClockInSchema.parse({ assignment_id: id, start_odometer_km: -1, start_fuel_gauge: 'HALF', start_media_object_id: id, consent_version: 'x' })).toThrow();
    expect(() => S.ClockInSchema.parse({ assignment_id: id, start_odometer_km: 1, start_fuel_gauge: 'SOME', start_media_object_id: id, consent_version: 'x' })).toThrow();
    expect(S.ClockOutSchema.parse({ shift_id: id, end_odometer_km: 12500, end_fuel_gauge: 'HALF', end_media_object_id: id, debrief_notes: 'n' }).end_odometer_km).toBe(12500);
  });
  it('login takes email XOR phone, and the session body carries the permission union', () => {
    expect(S.LoginSchema.safeParse({ email: 'd@fleet.local', password: 'p' }).success).toBe(true);
    expect(S.LoginSchema.safeParse({ phone: '+254700000000', password: 'p' }).success).toBe(true);
    expect(S.LoginSchema.safeParse({ password: 'p' }).success).toBe(false);
  });
  it('the photo-first refuel (the flow a driver can actually complete)', () => {
    const ok = { shift_id: id, vehicle_id: id, odometer_reading: 12345, receipt_media_object_id: id, odometer_photo_media_object_id: id, purchased_at: '2026-09-30T15:30:00Z' };
    expect(S.PhotoFirstRefuelSchema.parse(ok).odometer_reading).toBe(12345);
    expect(S.PhotoFirstRefuelSchema.safeParse({ ...ok, odometer_photo_media_object_id: undefined }).success).toBe(false);
  });
  it('U-12: the gauge-pair refuel route is gone from the backend AND from the client', () => {
    expect(realRoutes.has('POST /fuel/refuel')).toBe(false);
    expect(Object.keys(S)).not.toContain('RefuelSchema');
    expect(Object.keys(ENDPOINTS)).not.toContain('refuel');
    // The photo-first entry is the only driver fuel write, and it is a real route.
    expect(realRoutes.has('POST /driver/fuel/purchase')).toBe(true);
  });
  it('mayday works off shift (both ids nullable) and needs a real position', () => {
    expect(S.MaydaySchema.parse({ shift_id: null, vehicle_id: null, position: { latitude: -1.2921, longitude: 36.8219 }, mayday_reason: 'help' }).shift_id).toBeNull();
    expect(S.MaydaySchema.safeParse({ shift_id: null, vehicle_id: null, position: { latitude: 91, longitude: 0 }, mayday_reason: 'x' }).success).toBe(false);
    expect(S.MaydaySchema.safeParse({ shift_id: null, vehicle_id: null, position: { latitude: 0, longitude: 0 }, mayday_reason: '' }).success).toBe(false);
  });
  it('an accident report bounds the statement length the server accepts', () => {
    expect(S.AccidentCreateSchema.parse({ shift_id: null, vehicle_id: null, trailer_id: null, occurred_at: '2026-09-30T16:00:00Z', position: { latitude: 0, longitude: 0 } }).trailer_id).toBeNull();
    expect(S.AccidentCreateSchema.safeParse({ driver_statement: 'x'.repeat(5001) }).success).toBe(false);
  });
  it('a DVIR FAIL needs a note and a photo (the server rule, mirrored)', () => {
    const base = { shift_id: id, template_id: id, subject: 'VEHICLE', vehicle_id: id, trailer_id: null, previous_defects_reviewed: true, signature_name: 'J', items: [{ template_item_id: id, result: 'FAIL' as const }] };
    expect(S.InspectionSubmitStrictSchema.safeParse(base).success).toBe(false);
    expect(S.InspectionSubmitStrictSchema.safeParse({ ...base, items: [{ ...base.items[0], notes: 'worn' }] }).success).toBe(false);
    expect(S.InspectionSubmitStrictSchema.safeParse({ ...base, items: [{ ...base.items[0], notes: 'worn', photo_media_object_id: id }] }).success).toBe(true);
  });
  /**
   * The backend's TrailerSwapSchema has NO refine: a plate without a type parses. The earlier draft
   * invented the rule client-side; the server decides, so the app must not pre-empt it.
   */
  it('trailer swap: the server schema is authoritative, and bobtail is trailer_id null (C1.12)', () => {
    const base = { shift_id: id, vehicle_id: id, trailer_id: null, hook_media_object_id: id, hook_inspection_id: id };
    expect(S.TrailerSwapSchema.safeParse({ ...base, new_trailer_plate: 'KCA 789Y' }).success).toBe(true);
    expect(S.TrailerSwapSchema.safeParse({ ...base, new_trailer_plate: 'KCA 789Y', new_trailer_type: 'DRY_VAN' }).success).toBe(true);
    expect(S.TrailerSwapSchema.safeParse({ ...base }).success).toBe(true);
    expect(S.TrailerSwapSchema.safeParse({ ...base, new_trailer_type: 'HOVERCRAFT' }).success).toBe(false);
    expect(S.TrailerSwapSchema.safeParse({ ...base, hook_inspection_id: undefined }).success).toBe(false);
  });
});

describe('contract: the responses the app reads parse against the real schemas', () => {
  const session = {
    token_type: 'Bearer' as const, access_token: 'a', access_token_expires_at: '2026-09-30T10:00:00Z',
    refresh_token: 'r', refresh_token_expires_at: '2026-10-07T10:00:00Z', session_id: id, user_id: id,
    email: 'admin@fleet.local', phone: null, roles: ['ADMIN' as const], permissions: ['user:read' as const], locale: 'en' as const,
  };
  it('login / refresh: both return the same session body, and the client gates on `permissions`', () => {
    expect(S.SessionResponseSchema.parse(session).permissions).toEqual(['user:read']);
    expect(S.RefreshResponseSchema.parse(session).access_token).toBe('a');
    expect(S.SessionResponseSchema.safeParse({ ...session, roles: ['SUPERUSER'] }).success).toBe(false);
    expect(S.SessionResponseSchema.safeParse({ ...session, permissions: ['nope'] }).success).toBe(false);
  });
  it('the MFA gate is a challenge token, never tokens', () => {
    expect(S.MfaChallengeResponseSchema.parse({ mfa_required: true, mfa_challenge_token: 'c' }).mfa_challenge_token).toBe('c');
    expect(S.MfaChallengeResponseSchema.safeParse({ mfa_required: false }).success).toBe(false);
  });
  it('enrol returns recovery codes only (delivered OTP MFA, no TOTP secret)', () => {
    expect(S.MfaEnrollResponseSchema.parse({ recovery_codes: ['A'] }).recovery_codes).toHaveLength(1);
    expect(S.MfaEnrollResponseSchema.safeParse({ provisioning_uri: 'otpauth://x' }).success).toBe(false);
  });
  it('presign, consent gate, vehicle states, active shift (including null)', () => {
    expect(S.MediaUploadResponseSchema.parse({ media_object_id: id, upload_url: 'https://s3.amazonaws.com/fleet-media/x', expires_in_seconds: 60, method: 'PUT' }).method).toBe('PUT');
    expect(S.ConsentStatusSchema.parse({ consented: false, current_version: null, required_version: 'v1' }).required_version).toBe('v1');
    // The projection is `app.v_vehicle_display_state`, so every column is present; latitude/longitude are NULL.
    expect(S.VehicleStatesSchema.parse({ vehicles: [{ vehicle_id: id, display_state: 'MOVING', latitude: -1.29, longitude: 36.82, driver_name: 'John Doe', next_eligible_clock_in_at: null, plate: 'KDA 123A', odometer_km: '12345', engine_hours: null, vehicle_class: 'RIGID', asset_status: 'IN_USE', is_online: true, last_position_at: null, last_speed_kph: null }] }).vehicles).toHaveLength(1);
    expect(S.ActiveShiftSchema.parse(null)).toBeNull();
    expect(S.ActiveShiftSchema.parse({ shift_id: id, vehicle_id: id, trailer_id: null, clock_in_at: '2026-09-30T10:00:00Z' })?.shift_id).toBe(id);
  });
  it('the assignment endpoint returns ONE object (E-10)', () => {
    expect(S.DriverAssignmentSchema.parse({ assignment_id: id, vehicle_id: null, status: 'ACTIVE', starts_at: null, ends_at: null }).status).toBe('ACTIVE');
    expect(S.DriverAssignmentSchema.safeParse([]).success).toBe(false);
  });
  it('cursor pages, the driver roster, anomalies and expiring documents', () => {
    const page = S.cursorPage(S.DriverSummarySchema);
    expect(page.parse({ data: [{ user_id: id, email: 'd@fleet.local', full_name: 'John', mfa_enrolled: false, status: 'ACTIVE', last_login_at: '2026-09-30T08:00:00Z', devices: [{ device_id: id, platform: 'android', last_seen_at: null }] }], next_cursor: null, has_more: false }).has_more).toBe(false);
    expect(() => page.parse({ data: [], has_more: false })).toThrow();   // next_cursor is required (may be null)
    expect(S.AnomalySchema.parse({ domain: 'FUEL', id, severity: 'HIGH', kind: 'FUEL_ANOMALY_CRITICAL', vehicle_id: null, driver_id: null, detected_at: '2026-09-30T08:00:00Z', detail: null }).id).toBe(id);
    expect(S.ExpiringDocSchema.parse({ document_id: id, document_type: 'Insurance', document_number: 'KDA-1', is_blocking: false, expires_on: '2026-10-15', days_remaining: 15, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', subject_id: null, subject_type: null, linked_asset: 'KDA 123A', subject_name: null }).days_remaining).toBe(15);
  });
});