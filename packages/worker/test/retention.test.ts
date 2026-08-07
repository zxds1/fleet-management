// packages/worker/test/retention.test.ts
import { decideRetention, type RetentionContext } from "../src/ingest/retention";

const baseCtx = (over: Partial<RetentionContext> = {}): RetentionContext => ({
  shiftWindow: null,
  recoveryModeActive: false,
  openAccident: false,
  bufferMinutes: 15,
  ...over,
});

describe("decideRetention (C5.6 / N3.3)", () => {
  it("discards when no shift window and no forced exception", () => {
    const r = decideRetention(new Date("2026-01-01T12:00:00Z"), baseCtx());
    expect(r).toEqual({ action: "DISCARD" });
  });

  it("retains with SHIFT inside the core window", () => {
    const ctx = baseCtx({ shiftWindow: { start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T18:00:00Z") } });
    const r = decideRetention(new Date("2026-01-01T12:00:00Z"), ctx);
    expect(r).toEqual({ action: "RETAIN", reason: "SHIFT" });
  });

  it("retains with SHIFT_BUFFER inside the +/- buffer but outside core", () => {
    const ctx = baseCtx({ shiftWindow: { start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T18:00:00Z") } });
    const r = decideRetention(new Date("2026-01-01T09:50:00Z"), ctx);
    expect(r).toEqual({ action: "RETAIN", reason: "SHIFT_BUFFER" });
  });

  it("discards just beyond the buffer", () => {
    const ctx = baseCtx({ shiftWindow: { start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T18:00:00Z") } });
    const r = decideRetention(new Date("2026-01-01T09:30:00Z"), ctx);
    expect(r).toEqual({ action: "DISCARD" });
  });

  it("forces RETAIN on recovery mode regardless of shift", () => {
    const r = decideRetention(new Date("2026-01-01T03:00:00Z"), baseCtx({ recoveryModeActive: true }));
    expect(r).toEqual({ action: "RETAIN", reason: "RECOVERY_MODE" });
  });

  it("forces RETAIN on open accident regardless of shift", () => {
    const r = decideRetention(new Date("2026-01-01T03:00:00Z"), baseCtx({ openAccident: true }));
    expect(r).toEqual({ action: "RETAIN", reason: "ACCIDENT_FREEZE" });
  });
});
