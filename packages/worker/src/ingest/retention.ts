// packages/worker/src/ingest/retention.ts
// The retention transform (C5.6 / N3.3) — the discard step that turns Traccar's firehose
// into the regulated-tracking window. Pure and fully unit-tested: it decides, for one
// position timestamp, whether to keep it and under which retention_reason. The caller is
// responsible for resolving the context (shift window + forced-retention flags) for a vehicle.

export type RetentionReason = "SHIFT" | "SHIFT_BUFFER" | "RECOVERY_MODE" | "ACCIDENT_FREEZE";

export interface RetentionWindow {
  start: Date; // clock_in - buffer
  end: Date; // clock_out + buffer (or now+buffer for an open shift)
}

export interface RetentionContext {
  /** On-shift retained window for the vehicle, or null when no shift covers `at`. */
  shiftWindow: RetentionWindow | null;
  /** An active recovery_modes row for the vehicle (N3.1) — forces retention off-shift. */
  recoveryModeActive: boolean;
  /** An open accident_reports row for the vehicle (N3.2) — forces retention off-shift. */
  openAccident: boolean;
  /** shift.retention_window_minutes (N3.3), default 15. */
  bufferMinutes: number;
}

export type RetentionDecision =
  | { action: "DISCARD" }
  | { action: "RETAIN"; reason: RetentionReason };

/**
 * Decide whether a position recorded at `recordedAt` may be retained.
 * Invariants (04 §3): on-shift → SHIFT/SHIFT_BUFFER; off-shift → DISCARD unless a forced
 * exception (recovery mode, open accident) applies.
 */
export function decideRetention(recordedAt: Date, ctx: RetentionContext): RetentionDecision {
  if (ctx.recoveryModeActive) return { action: "RETAIN", reason: "RECOVERY_MODE" };
  if (ctx.openAccident) return { action: "RETAIN", reason: "ACCIDENT_FREEZE" };

  const win = ctx.shiftWindow;
  if (!win) return { action: "DISCARD" };

  const bufferMs = ctx.bufferMinutes * 60_000;
  const bufStart = new Date(win.start.getTime() - bufferMs);
  const bufEnd = new Date(win.end.getTime() + bufferMs);

  if (recordedAt < bufStart || recordedAt > bufEnd) return { action: "DISCARD" };

  const inCore = recordedAt >= win.start && recordedAt <= win.end;
  return { action: "RETAIN", reason: inCore ? "SHIFT" : "SHIFT_BUFFER" };
}
