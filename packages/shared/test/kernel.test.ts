/**
 * @fleet/shared — unit tests (pure kernel utilities; no mocking).
 * Run: npm test (Jest + ts-jest). Backs the >=80% gate for the kernel (C5.8/A3.3).
 */
import { ok, err, isOk, isErr } from "../src/result";
import { operationalDate, addInterval } from "../src/time";
import { ValidationError, SemanticViolation, Forbidden } from "../src/errors";
import { ClockInSchema } from "../src/schemas/shifts";

describe("result", () => {
  it("ok/err discriminators", () => {
    const o = ok(1);
    const e = err(new Forbidden());
    expect(isOk(o)).toBe(true);
    expect(isErr(e)).toBe(true);
    if (isOk(o)) expect(o.value).toBe(1);
  });
});

describe("errors", () => {
  it("maps to RFC7807 with stable error_code", () => {
    const v = new ValidationError("bad", [{ field: "email", code: "REQUIRED", message: "x" }]);
    expect(v.toProblem()).toMatchObject({ status: 400, error_code: "VALIDATION_ERROR" });
    const s = new SemanticViolation("ODOMETER_DECREASED", "nope");
    expect(s.toProblem().error_code).toBe("ODOMETER_DECREASED");
  });
});

describe("time", () => {
  it("operationalDate returns YYYY-MM-DD in EAT", () => {
    // 2026-08-06T21:00:00Z == 2026-08-07 in EAT (UTC+3)
    expect(operationalDate(new Date("2026-08-06T21:00:00Z"))).toBe("2026-08-07");
  });
  it("addInterval is pure", () => {
    const d = new Date("2026-08-06T00:00:00Z");
    expect(addInterval(d, { days: 1 }).toISOString()).toBe("2026-08-07T00:00:00.000Z");
  });
});

describe("schemas", () => {
  it("rejects a bad clock-in body", () => {
    const r = ClockInSchema.safeParse({
      assignment_id: "x",
      start_odometer_km: -1,
      start_fuel_gauge: "FULL",
      start_media_object_id: "y",
      consent_version: "v1",
    });
    expect(r.success).toBe(false);
  });
  it("accepts a valid clock-in body", () => {
    const r = ClockInSchema.safeParse({
      assignment_id: "11111111-1111-4111-8111-111111111111",
      start_odometer_km: 100,
      start_fuel_gauge: "FULL",
      start_media_object_id: "22222222-2222-4222-8222-222222222222",
      consent_version: "v1",
    });
    expect(r.success).toBe(true);
  });
});
