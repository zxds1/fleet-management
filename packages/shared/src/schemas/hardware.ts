// packages/shared/src/schemas/hardware.ts
import { z } from "zod";

export const TRACKER_BRANDS = [
  "GENERIC_H02",
  "TELTONIKA",
  "QUECLINK",
  "JIMI",
  "TK_STAR",
  "CALE",
  "SINTRONES",
] as const;
export type TrackerBrand = (typeof TRACKER_BRANDS)[number];

export const TRACKER_DEVICE_MODELS: ReadonlyArray<{ brand: TrackerBrand; models: ReadonlyArray<string> }> = [
  { brand: "GENERIC_H02", models: ["GENERIC", "H02"] },
  { brand: "TELTONIKA", models: ["FMB920", "FMB140", "FMC130"] },
  { brand: "QUECLINK", models: ["GV300", "GB100"] },
  { brand: "JIMI", models: ["VL901", "JC450"] },
  { brand: "TK_STAR", models: ["TK102", "TK103"] },
  { brand: "CALE", models: ["CALE"] },
  { brand: "SINTRONES", models: ["AB1"] },
];

/** `POST /admin/hardware/pair` body (A1.1, N2.3). `trackerImei` is exactly 15 digits. */
export const HardwarePairSchema = z.object({
  vehicleId: z.string().uuid(),
  trackerImei: z.string().regex(/^\d{15}$/),
  trackerBrand: z.enum(TRACKER_BRANDS),
  trackerSimNumber: z.string().optional(),
  trackerModel: z.string().optional(),
});
export type HardwarePairInput = z.infer<typeof HardwarePairSchema>;

/** `POST /admin/hardware/pair` 2xx body — the installer SMS command shown to the provisioner. */
export const HardwarePairResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  smsCommand: z.string().optional(),
  simNumber: z.string().optional(),
  trackerImei: z.string().optional(),
  vehicleId: z.string().optional(),
});
export type HardwarePairResult = z.infer<typeof HardwarePairResultSchema>;

/** `DELETE /admin/hardware/:vehicleId/tracker` 2xx body — confirms the binding was cleared. */
export const HardwareUnpairResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  vehicleId: z.string().uuid(),
  trackerImei: z.string().nullable(),
});
export type HardwareUnpairResult = z.infer<typeof HardwareUnpairResultSchema>;

/** One row of `GET /admin/hardware/pending` — the tracker status board. */
export const HardwareTrackerStatusSchema = z.object({
  imei: z.string(),
  vehiclePlate: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  status: z.enum(["PENDING", "ONLINE", "OFFLINE", "LOST"]).default("PENDING"),
  pairedAt: z.string().nullable().optional(),
  lastPing: z.string().nullable().optional(),
});
export type HardwareTrackerStatus = z.infer<typeof HardwareTrackerStatusSchema>;
