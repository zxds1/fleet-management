import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import * as mod from '../src';
import {
  AccidentCreateSchema,
  AppError,
  ClientProblemError,
  ClockInSchema,
  ClockOutSchema,
  ConsentStatusSchema,
  DriverAssignmentSchema,
  ERROR_CODES,
  ERROR_CODE_BUCKET,
  FuelCorrectionSchema,
  InspectionSubmitStrictSchema,
  InspectionSubmitSchema,
  LoginSchema,
  MfaChallengeResponseSchema,
  MfaEnrollResponseSchema,
  MfaVerifySchema,
  N5_ORDER,
  PhotoFirstRefuelSchema,
  SERVER_ERROR_CODES,
  SessionResponseSchema,
  StatementImportSchema,
  VehicleStatesSchema,
  can,
  cursorPage,
  err,
  ok,
  parseProblem,
  principalFromSessionBody,
  redact,
  RealtimeEvents,
} from '../src';

const id = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';

describe('errors: the catalogue is the backend catalogue', () => {
  it('every server code is UPPER_SNAKE and unique, and the client-only codes are separate', () => {
    expect(new Set(SERVER_ERROR_CODES).size).toBe(SERVER_ERROR_CODES.length);
    for (const c of SERVER_ERROR_CODES) expect(c).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(SERVER_ERROR_CODES).toContain('IDEMPOTENCY_CONFLICT');
    expect(SERVER_ERROR_CODES).toContain('IDEMPOTENCY_INFLIGHT');
    expect(SERVER_ERROR_CODES).not.toContain('DEVICE_UNKNOWN');
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
  it('ERROR_CODE_BUCKET is exactly the set the app can be shown', () => {
    expect(Object.keys(ERROR_CODE_BUCKET).sort()).toEqual([...SERVER_ERROR_CODES]);
  });
  it('retry classification matches the backend RETRYABLE set', () => {
    expect(ERROR_CODE_BUCKET.SERVICE_UNAVAILABLE).toBe('transient');
    expect(ERROR_CODE_BUCKET.RATE_LIMITED).toBe('transient');
    expect(ERROR_CODE_BUCKET.IDEMPOTENCY_INFLIGHT).toBe('transient');
    expect(ERROR_CODE_BUCKET.IDEMPOTENCY_CONFLICT).toBe('client');
    expect(ERROR_CODE_BUCKET.ODOMETER_DECREASED).toBe('business');
    expect(new ClientProblemError(409, 'IDEMPOTENCY_INFLIGHT', 'x').isRetryable).toBe(true);
    expect(new ClientProblemError(422, 'IDEMPOTENCY_CONFLICT', 'x').isRetryable).toBe(false);
  });
  it('toProblem round-trips through parseProblem', () => {
    const e = new ClientProblemError(422, 'ODOMETER_DECREASED', 'T', 'D', [{ field: 'f', code: 'c', message: 'm' }], 'req-1');
    expect(parseProblem(422, e.toProblem())).toMatchObject({ error_code: 'ODOMETER_DECREASED', detail: 'D', requestId: 'req-1' });
    expect(e.status).toBe(422);
    expect(e.toProblem().type).toBe('https://docs.fleet.internal/problems/odometer_decreased');
  });
  it('a body with no error_code becomes UNKNOWN, never a crash', () => {
    expect(parseProblem(502, '<html>').error_code).toBe('UNKNOWN');
    expect(parseProblem(500, {}).error_code).toBe('UNKNOWN');
  });
  it('AppError is abstract: only concrete subclasses exist on the wire', () => {
    expect(new ClientProblemError(403, 'FORBIDDEN', 'no') instanceof AppError).toBe(true);
  });
});

describe('types and the locked enums', () => {
  it('N5 precedence is fixed', () => expect([...N5_ORDER]).toEqual(['QUARANTINED', 'OFFLINE', 'HOS_ALERT', 'SPEEDING', 'MOVING', 'IDLING', 'PARKED']));
  it('cursorPage requires next_cursor (null allowed)', () => {
    const p = cursorPage(z.string());
    expect(p.safeParse({ data: [], next_cursor: null, has_more: false }).success).toBe(true);
    expect(p.safeParse({ data: [], has_more: false }).success).toBe(false);
  });
});

describe('auth contract', () => {
  it('login takes email XOR phone, never neither', () => {
    expect(LoginSchema.safeParse({ email: 'admin@fleet.local', password: 'p' }).success).toBe(true);
    expect(LoginSchema.safeParse({ phone: '+254700000000', password: 'p' }).success).toBe(true);
    expect(LoginSchema.safeParse({ password: 'p' }).success).toBe(false);
    expect(LoginSchema.safeParse({ email: 'a@b.c' }).success).toBe(false);
  });
  it('the session body carries the permission union the client gates on', () => {
    const r = SessionResponseSchema.parse({
      token_type: 'Bearer', access_token: 'a', access_token_expires_at: '2026-09-30T10:00:00Z',
      refresh_token: 'r', refresh_token_expires_at: '2026-10-07T10:00:00Z', session_id: id, user_id: id,
      email: 'admin@fleet.local', phone: null, roles: ['ADMIN'], permissions: ['user:read'], locale: 'en',
    });
    expect(r.permissions).toEqual(['user:read']);
    expect(() => SessionResponseSchema.parse({ ...r, roles: ['SUPERUSER'] })).toThrow();
    expect(() => SessionResponseSchema.parse({ ...r, permissions: ['not:a:permission'] })).toThrow();
  });
  it('the MFA gate returns a challenge token, not tokens', () => {
    expect(MfaChallengeResponseSchema.parse({ mfa_required: true, mfa_challenge_token: 'c' }).mfa_challenge_token).toBe('c');
    expect(MfaChallengeResponseSchema.safeParse({ mfa_required: false }).success).toBe(false);
  });
  it('mfa/verify takes a challenge token plus an OTP or a recovery code', () => {
    expect(MfaVerifySchema.safeParse({ mfa_challenge_token: 'c', code: '123456' }).success).toBe(true);
    expect(MfaVerifySchema.safeParse({ mfa_challenge_token: 'c', code: 'ABCD-EFGH' }).success).toBe(true);
    expect(MfaVerifySchema.safeParse({ mfa_challenge_token: 'c', code: '12' }).success).toBe(false);
    expect(MfaVerifySchema.safeParse({ code: '123456' }).success).toBe(false);
  });
  it('enrol returns recovery codes only — MFA is a delivered OTP, there is no TOTP secret', () => {
    expect(MfaEnrollResponseSchema.parse({ recovery_codes: ['A', 'B'] }).recovery_codes).toHaveLength(2);
    expect(MfaEnrollResponseSchema.safeParse({ provisioning_uri: 'otpauth://x' }).success).toBe(false);
  });
  it('the assignment endpoint returns one object, and the consent gate returns three fields', () => {
    expect(DriverAssignmentSchema.parse({ assignment_id: id, vehicle_id: null, status: 'ACTIVE', starts_at: null, ends_at: null }).status).toBe('ACTIVE');
    expect(ConsentStatusSchema.parse({ consented: false, current_version: null, required_version: 'v1' }).required_version).toBe('v1');
  });
});

describe('shift / fuel / inspection / accident contracts', () => {
  it('clock-in requires a UUID assignment and a non-empty consent_version', () => {
    const base = { assignment_id: id, start_odometer_km: 12345, start_fuel_gauge: 'HALF', start_media_object_id: id };
    expect(ClockInSchema.safeParse({ ...base, consent_version: '' }).success).toBe(false);
    expect(ClockInSchema.safeParse({ ...base, consent_version: 'v1' }).success).toBe(true);
    expect(ClockInSchema.safeParse({ ...base, consent_version: 'v1', start_odometer_km: -1 }).success).toBe(false);
    expect(ClockInSchema.safeParse({ ...base, consent_version: 'v1', start_fuel_gauge: 'SOME' }).success).toBe(false);
  });
  it('clock-out is the same shape without an assignment', () => {
    expect(ClockOutSchema.safeParse({ shift_id: id, end_odometer_km: 12500, end_fuel_gauge: 'HALF', end_media_object_id: id }).success).toBe(true);
  });
  it('the gauge-pair refuel is GONE (U-12 retired): only the photo-first entry remains', () => {
    // Retired deliberately: nothing ever created an app.fuel_records row, so before/after ids could not be
    // obtained, and the route's `fuel:enter` permission did not exist. The DB backs photo-first with
    // entry_source DRIVER_PHOTO (migration 12), so that is the only driver fuel path.
    expect((mod as Record<string, unknown>).RefuelSchema).toBeUndefined();
    expect(SERVER_ERROR_CODES).not.toContain('MISSING_GAUGE_PAIR');
  });
  it('the photo-first refuel is the flow a driver can actually complete', () => {
    const ok = { shift_id: id, vehicle_id: id, odometer_reading: 12345, receipt_media_object_id: id, odometer_photo_media_object_id: id, purchased_at: '2026-09-30T15:30:00Z' };
    expect(PhotoFirstRefuelSchema.safeParse(ok).success).toBe(true);
    expect(PhotoFirstRefuelSchema.safeParse({ ...ok, odometer_photo_media_object_id: undefined }).success).toBe(false);
    expect(FuelCorrectionSchema.safeParse({ purchase_id: id, corrected_liters: 45 }).success).toBe(true);
    expect(FuelCorrectionSchema.safeParse({ purchase_id: id, corrected_date: '30/09/2026' }).success).toBe(false);
  });
  it('a DVIR FAIL needs both a note and a photo (the server rule, mirrored)', () => {
    const base = { shift_id: id, template_id: id, subject: 'VEHICLE', vehicle_id: id, trailer_id: null, previous_defects_reviewed: true, signature_name: 'J', items: [{ template_item_id: id, result: 'FAIL' }] };
    expect(InspectionSubmitSchema.safeParse(base).success).toBe(true);
    expect(InspectionSubmitStrictSchema.safeParse(base).success).toBe(false);
    expect(InspectionSubmitStrictSchema.safeParse({ ...base, items: [{ ...base.items[0], notes: 'worn' }] }).success).toBe(false);
    expect(InspectionSubmitStrictSchema.safeParse({ ...base, items: [{ ...base.items[0], notes: 'worn', photo_media_object_id: id }] }).success).toBe(true);
    expect(InspectionSubmitSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });
  it('accident bounds: valid coordinates and a statement length the server accepts', () => {
    const base = { shift_id: null, vehicle_id: null, trailer_id: null, occurred_at: '2026-09-30T16:00:00Z', position: { latitude: -1.2921, longitude: 36.8219 }, driver_statement: 'x' };
    expect(AccidentCreateSchema.safeParse(base).success).toBe(true);
    expect(AccidentCreateSchema.safeParse({ ...base, position: { latitude: 91, longitude: 0 } }).success).toBe(false);
    expect(AccidentCreateSchema.safeParse({ ...base, driver_statement: 'x'.repeat(5001) }).success).toBe(false);
    expect(AccidentCreateSchema.safeParse({ ...base, position_source: 'GUESS' }).success).toBe(false);
  });
  it('vehicle states: latitude and longitude are nullable on the wire', () => {
    const row = { vehicle_id: id, display_state: 'OFFLINE', latitude: null, longitude: null, driver_name: null, next_eligible_clock_in_at: null, plate: 'KDA 123A', odometer_km: null, engine_hours: null, vehicle_class: 'RIGID', asset_status: 'IN_USE', is_online: false, last_position_at: null, last_speed_kph: null };
    expect(VehicleStatesSchema.safeParse({ vehicles: [row] }).success).toBe(true);
    expect(VehicleStatesSchema.safeParse({ vehicles: [{ ...row, display_state: 'FLYING' }] }).success).toBe(false);
  });
  it('a statement import needs ISO dates and a column mapping', () => {
    const ok = { provider: 'Bank', period_start: '2026-09-01', period_end: '2026-09-30', media_object_id: id, column_mapping: { date: 'd' } };
    expect(StatementImportSchema.safeParse(ok).success).toBe(true);
    expect(StatementImportSchema.safeParse({ ...ok, period_start: '1/9/2026' }).success).toBe(false);
  });
});

describe('permissions', () => {
  it('strict when the trusted body carried the union; open only when it did not', () => {
    const strict = principalFromSessionBody({ user_id: id, roles: ['ADMIN'], permissions: ['fuel:verify', 7] });
    expect(can(strict, 'fuel:verify')).toBe(true);
    expect(can(strict, 'fuel:adjust')).toBe(false);
    const open = principalFromSessionBody({ user_id: id, roles: ['ADMIN'] });
    expect(open!.permissions).toBeNull();
    expect(can(open, 'fuel:adjust')).toBe(true);
    expect(can(null, 'fuel:verify')).toBe(false);
    expect(principalFromSessionBody(null)).toBeNull();
    expect(principalFromSessionBody({} as never)).toBeNull();
  });
  it('roles fall back to the supplied list when the body omits them', () =>
    expect(principalFromSessionBody({ user_id: id }, ['DRIVER'])!.roles).toEqual(['DRIVER']));
});

describe('realtime: the gateway pushes events, it never accepts a subscription', () => {
  it('event names are unprefixed and cover exactly the six server topics', () => {
    expect(Object.values(RealtimeEvents).sort()).toEqual(['accident:live', 'driver:accident', 'driver:shift', 'driver:vehicle', 'map:vehicle-states', 'notifications']);
  });
});

describe('logging + result helpers', () => {
  it('redact hides secrets at any depth and trims long strings', () => {
    const r = redact({ email: 'a@b.c', password: 'p', nested: { refresh_token: 't', ok: 1, list: [{ pin: '1234' }] }, big: 'x'.repeat(500) }) as Record<string, unknown>;
    expect(r.password).toBe('[redacted]');
    expect((r.nested as Record<string, unknown>).refresh_token).toBe('[redacted]');
    expect((r.big as string).length).toBeLessThan(250);
  });
  it('ok/err build Results', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('x')).toEqual({ ok: false, error: 'x' });
  });
});