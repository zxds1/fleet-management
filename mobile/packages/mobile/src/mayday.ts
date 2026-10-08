import { MaydaySchema } from '@fleet/shared';
import { ENDPOINTS, url } from './api/endpoints';
import { currentFix } from './core/location';
import { writeOrQueue } from './services';

export type MaydayResult = 'SENT' | 'QUEUED' | 'NO_GPS';

/**
 * The one place a Mayday is built and sent. Works off-shift (nulls), needs no photos, and queues with
 * its idempotency key if there is no signal, so it is delivered the moment connectivity returns.
 * Returns NO_GPS only if there is no position at all.
 *
 * `POST /accidents/mayday` (B17) bypasses every evidence rule: GPS + a reason only, and the escalation
 * fires on the spot. `shift_id` and `vehicle_id` are required keys but nullable, which is how the API
 * expresses "off shift" (C1.14).
 */
export async function sendMayday(ctx: { shift_id: string | null; vehicle_id: string | null }, reason?: string): Promise<MaydayResult> {
  const fix = await currentFix();
  if (!fix) return 'NO_GPS';
  const r = await writeOrQueue(url(ENDPOINTS.mayday), MaydaySchema.parse({ ...ctx, position: fix, mayday_reason: reason?.trim() || 'MAYDAY' }));
  return r.queued ? 'QUEUED' : 'SENT';
}