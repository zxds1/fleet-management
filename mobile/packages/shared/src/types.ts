/**
 * Wire enums and value types, mirrored from `fleet-management/packages/shared/src/types/db.ts`.
 * UPPERCASE values, snake_case keys — exactly what the server sends.
 */

import { z } from 'zod';

export const ShiftState = z.enum(['OPEN', 'PENDING_CLOSEOUT', 'CLOSED']);
export type ShiftState = z.infer<typeof ShiftState>;

export const ShiftVerificationStatus = z.enum(['PENDING', 'VERIFIED', 'FLAGGED']);
export type ShiftVerificationStatus = z.infer<typeof ShiftVerificationStatus>;

export const ShiftEventSource = z.enum(['DRIVER', 'ADMIN_OVERRIDE', 'AUTO_GEOFENCE', 'SYSTEM_VEHICLE_SWAP']);
export type ShiftEventSource = z.infer<typeof ShiftEventSource>;

export const FuelGaugeLevel = z.enum(['EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL']);
export type FuelGaugeLevel = z.infer<typeof FuelGaugeLevel>;

export const InspectionResult = z.enum(['PASS', 'FAIL', 'NOT_APPLICABLE']);
export type InspectionResult = z.infer<typeof InspectionResult>;

export const InspectionSubject = z.enum(['VEHICLE', 'TRAILER', 'TRAILER_SWAP']);
export type InspectionSubject = z.infer<typeof InspectionSubject>;

export const TrailerType = z.enum(['DRY_VAN', 'REEFER', 'FLATBED', 'LOWBOY', 'TANKER', 'CURTAIN_SIDE', 'OTHER']);
export type TrailerType = z.infer<typeof TrailerType>;

export const VehicleClass = z.enum(['TRACTOR', 'RIGID', 'VAN', 'PICKUP']);
export type VehicleClass = z.infer<typeof VehicleClass>;

export const AssetStatus = z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'QUARANTINED', 'RETIRED', 'EXTERNAL']);
export type AssetStatus = z.infer<typeof AssetStatus>;

/** N5 precedence, highest first: a vehicle shows the FIRST state in this list that applies. */
export const N5_ORDER = ['QUARANTINED', 'OFFLINE', 'HOS_ALERT', 'SPEEDING', 'MOVING', 'IDLING', 'PARKED'] as const;
export const VehicleDisplayState = z.enum(N5_ORDER);
export type VehicleDisplayState = z.infer<typeof VehicleDisplayState>;

export const AnomalyDomain = z.enum(['FUEL', 'HOS', 'ACCIDENT', 'MAINTENANCE', 'SECURITY']);
export type AnomalyDomain = z.infer<typeof AnomalyDomain>;

/** The anomaly severities the API projects for the client (`AnomalyQuery.toClientSeverity`). */
export const AnomalySeverity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type AnomalySeverity = z.infer<typeof AnomalySeverity>;

export const OcrStatus = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'NOT_APPLICABLE']);
export type OcrStatus = z.infer<typeof OcrStatus>;

export const ConsentType = z.enum(['GPS_TRACKING_WORKING_HOURS', 'PHONE_GPS_FALLBACK', 'DATA_PROCESSING_NOTICE']);
export type ConsentType = z.infer<typeof ConsentType>;

export const AccidentSeverity = z.enum(['MINOR', 'MODERATE', 'SEVERE']);
export type AccidentSeverity = z.infer<typeof AccidentSeverity>;

export const AccidentPositionSource = z.enum(['TRACKER', 'PHONE_GPS', 'MANUAL']);
export type AccidentPositionSource = z.infer<typeof AccidentPositionSource>;

export const FuelPurchaseBadge = z.enum(['AUTO', 'REVIEW', 'FLAGGED']);
export type FuelPurchaseBadge = z.infer<typeof FuelPurchaseBadge>;

export const MediaOwnerKind = z.enum([
  'WORK_LOG',
  'INSPECTION_ITEM',
  'FUEL_RECORD',
  'FUEL_PURCHASE',
  'EXPENSE',
  'ACCIDENT_REPORT',
  'ASSET_DOCUMENT',
  'TRAILER_ASSIGNMENT',
  'MAINTENANCE_RECORD',
  'QUARANTINE_EVENT',
  'STATEMENT_IMPORT',
]);
export type MediaOwnerKind = z.infer<typeof MediaOwnerKind>;

export const MediaRetentionClass = z.enum([
  'WORK_PLAN',
  'INSPECTION',
  'FUEL_RECEIPT',
  'FUEL_DASHBOARD',
  'EXPENSE_RECEIPT',
  'ACCIDENT',
  'ASSET_DOCUMENT',
  'MAINTENANCE',
  'STATEMENT_IMPORT',
  'TRAILER_SWAP',
]);
export type MediaRetentionClass = z.infer<typeof MediaRetentionClass>;

/** Money is always a decimal string with a 3-letter currency; the backend fixes it to KES. */
export interface Money {
  amount: string;
  currency: 'KES';
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Cursor pagination only (D7). `next_cursor` is always present, null on the last page. */
export interface CursorPage<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export const uuid = z.string().uuid();
export const isoDateTime = z.string().datetime();
export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export const moneySchema = z.object({ amount: z.string(), currency: z.literal('KES') });
export const cursorPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable(), has_more: z.boolean() });