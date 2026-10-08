/**
 * Live alerts from the gateway's push events.
 *
 * The payloads are the backend's own projections:
 *  • `accident:live` — the raw accident event published to the on-call room. A Mayday sets `mayday`.
 *  • `driver:accident` — the driver-scoped accident event; the gateway forwards whatever the producer
 *    published (an escalation/acknowledgement change on their own report).
 *
 * Everything here is untrusted input: ids must be UUIDs and free text is cut to a safe length, so a
 * malformed or hostile event can never put arbitrary content in front of someone.
 */
import { RealtimeEvents } from '@fleet/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LiveAlert = { kind: 'MAYDAY'; accidentId: string } | { kind: 'ACCIDENT_UPDATE'; text: string; accidentId?: string };

const asRecord = (payload: unknown): Record<string, unknown> | null =>
  payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;

/** Accepts either `accident_id` or `id`, so it survives a producer that names it differently. */
const accidentIdOf = (p: Record<string, unknown>): string | undefined => {
  for (const key of ['accident_id', 'id'] as const) {
    const v = p[key];
    if (typeof v === 'string' && UUID.test(v)) return v;
  }
  return undefined;
};

const STATUS_KEYS = ['escalation_status', 'status', 'escalation_tier', 'reason'] as const;

export function alertFromEvent(event: string, payload: unknown): LiveAlert | null {
  const p = asRecord(payload);
  if (!p) return null;
  const id = accidentIdOf(p);

  if (event === RealtimeEvents.accidentLive) {
    return p.mayday === true && id ? { kind: 'MAYDAY', accidentId: id } : null;
  }

  if (event === RealtimeEvents.driverAccident) {
    for (const key of STATUS_KEYS) {
      const v = p[key];
      if (typeof v === 'string' && v.trim()) {
        return { kind: 'ACCIDENT_UPDATE', text: v.replace(/[_\s]+/g, ' ').trim().slice(0, 40).toLowerCase(), accidentId: id };
      }
      if (typeof v === 'number' && Number.isFinite(v)) {
        return { kind: 'ACCIDENT_UPDATE', text: `tier ${Math.trunc(v)}`, accidentId: id };
      }
    }
  }
  return null;
}