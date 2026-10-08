// packages/shared/src/schemas/hardware.ts
// Mirrored from fleet-management/packages/shared/src/schemas/hardware.ts (A1.1 tracker provisioning).
import { z } from 'zod';

export const TRACKER_BRANDS = [
  'GENERIC_H02',
  'TELTONIKA',
  'QUECLINK',
  'JIMI',
  'TK_STAR',
  'CALE',
  'SINTRONES',
] as const;
export type TrackerBrand = (typeof TRACKER_BRANDS)[number];

/** `POST /admin/hardware/pair` body (A1.1, N2.3). `trackerImei` is exactly 15 digits. */
export const HardwarePairSchema = z.object({
  vehicleId: z.string().uuid(),
  trackerImei: z.string().regex(/^\d{15}$/),
  trackerBrand: z.enum(TRACKER_BRANDS),
  trackerSimNumber: z.string().optional(),
  trackerModel: z.string().optional(),
});
export type HardwarePairInput = z.infer<typeof HardwarePairSchema>;
