/**
 * Screen-facing names for the real schemas.
 *
 * The app's screens were written against invented names and invented field names. Rather than keep
 * two parallel vocabularies, every old screen name now points at the REAL schema from
 * `fleet-management/packages/shared/src/schemas/*`. A screen still has to be updated when it reads a
 * field the backend never sends (there is no alias for that), which is exactly the signal we want.
 */
import { z } from 'zod';
import { ConsentStatusSchema } from './schemas/auth';
import { ShiftVerificationStatus, FuelGaugeLevel } from './types';
import { ShiftVerificationInboxRowSchema, VerifyShiftSchema } from './schemas/shifts';
import { FuelReconciliationRowSchema, StatementImportResponseSchema, StatementImportSchema, VerifyPurchaseSchema } from './schemas/fuel';
import { DvirDetailSchema, DvirSummaryRowSchema, InspectionSubmitSchema } from './schemas/inspections';
import { AccidentSummaryRowSchema } from './schemas/accidents';
import { AnomalyRowSchema, DocumentDetailSchema, DocumentSummarySchema } from './schemas/dashboard';
import { VehicleRecordSchema } from './schemas/auth';
import { SessionResponseSchema } from './schemas/auth';
import { MediaUploadSchema } from './schemas/media';

// The five fuel-gauge positions the API accepts. Aliased because `GaugePicker` predates the rename.
export const FuelGauge = FuelGaugeLevel;
export type FuelGauge = FuelGaugeLevel;
export const VerificationStatus = ShiftVerificationStatus;
export type VerificationStatus = z.infer<typeof ShiftVerificationStatus>;

export const LoginResponseSchema = SessionResponseSchema;
export type LoginResponse = z.infer<typeof SessionResponseSchema>;
export const RefreshResponseSchema = SessionResponseSchema;
export const ConsentRequiredSchema = ConsentStatusSchema;
export const DriverDetailResponseSchema = VehicleRecordSchema;

export const InspectionSchema = InspectionSubmitSchema;
export { InspectionTemplatesResponseSchema as InspectionTemplatesSchema } from './schemas/inspections';

export const AccidentRowSchema = AccidentSummaryRowSchema;
export const FuelRowSchema = FuelReconciliationRowSchema;
export const FuelDetailSchema = FuelReconciliationRowSchema;
export const InspectionRowSchema = DvirSummaryRowSchema;
export const InspectionDetailSchema = DvirDetailSchema;
export const ShiftRowSchema = ShiftVerificationInboxRowSchema;
export const VehicleDetailSchema = VehicleRecordSchema;

export const AnomalySchema = AnomalyRowSchema;
export const ExpiringDocSchema = DocumentSummarySchema;
export const DocDetailSchema = DocumentDetailSchema;

export const StatementRequestSchema = StatementImportSchema;
export const StatementResponseSchema = StatementImportResponseSchema;
export const VerifyShiftRequestSchema = VerifyShiftSchema;
export const VerifyFuelRequestSchema = VerifyPurchaseSchema;
export const MediaUploadRequestSchema = MediaUploadSchema;