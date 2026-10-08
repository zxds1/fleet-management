import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ENDPOINTS, url } from './api/endpoints';
import { ActiveShiftSchema, AnalyticsKpisSchema, AnalyticsReportSchema, VehicleAnalyticsSchema, DriverAnalyticsSchema, CompanyAnalyticsSchema, ManagerAnalyticsSchema, VehicleAnalyticsDetailSchema, DriverAnalyticsDetailSchema, DriverOnboardingSchema, FuelCardsResponseSchema, TrailersResponseSchema, VehicleCreateSchema, VehicleRecordSchema, VehicleStatesSchema, VehicleUpdateSchema, AssignVehicleSchema, VehicleIssueCreateSchema, VehicleIssueOutcomeSchema, VehicleIssueListRowSchema, TrainingLessonSchema, TrainingRosterRowSchema, MaintenanceRecordSchema, cursorPage, type AnalyticsKpis, type VehicleAnalytics, type DriverAnalytics, type CompanyAnalytics, type ManagerAnalytics, type VehicleAnalyticsDetail, type DriverAnalyticsDetail, type VehicleCreateInput, type VehicleUpdateInput, type AssignVehicleInput, type VehicleIssueCreateInput, type VehicleIssueOutcome, type VehicleIssueListRow, type TrainingLesson, type TrainingRosterRow, type MaintenanceRecord } from '@fleet/shared';
import { ttl } from './core/queryConfig';
import { api } from './services';

export const shiftActiveQuery = {
  queryKey: ['shift-active'],
  queryFn: () => api.get(url(ENDPOINTS.activeShift), { schema: ActiveShiftSchema }),
  ...ttl('shift-active'),
};

export const vehicleStatesQuery = {
  queryKey: ['vehicle-states'],
  queryFn: () => api.get(url(ENDPOINTS.vehicleStates), { schema: VehicleStatesSchema }),
  ...ttl('vehicle-states'),
};

/**
 * U-03 resolved: `GET /trailers` returns every available, operational trailer, bounded at 200. A row with
 * a `current_vehicle_id` cannot be hooked, so the picker hides it.
 */
export const trailersQuery = {
  queryKey: ['trailers'],
  queryFn: () => api.get(url(ENDPOINTS.trailers), { schema: TrailersResponseSchema }),
  ...ttl('trailers'),
};

/**
 * U-05 resolved: `GET /fuel/cards` returns the cards that may be presented for this vehicle — its own
 * dedicated card plus every pooled one. `last_four` is deliberately not returned, so the form still asks.
 */
export const fuelCardsQuery = (vehicleId: string | null | undefined) => ({
  queryKey: ['fuel-cards', vehicleId ?? null] as const,
  enabled: !!vehicleId,
  queryFn: () => api.get(url(ENDPOINTS.selectableFuelCards), { query: { vehicle_id: vehicleId! }, schema: FuelCardsResponseSchema }),
  ...ttl('fuel-cards'),
});

/**
 * S-08 partly resolved: this is the only endpoint that returns exact counts, so the admin overview and
 * its badges read it rather than the size of a page. It needs `report:read` (ADMIN, FLEET_MANAGER), so
 * a driver gets nothing from it and keeps the page-size badge.
 */
export const analyticsReportQuery = {
  queryKey: ['analytics-report'],
  queryFn: () => api.get(url(ENDPOINTS.analytics), { schema: AnalyticsReportSchema }),
  ...ttl('analytics-report'),
};

/**
 * E-13 / U-04 resolved: `GET /vehicles/{id}` returns the vehicle's last ACCEPTED odometer
 * (`current_odometer_km`) and when it was recorded. `asset:read` is a DRIVER permission, so the
 * clock-in and clock-out forms can pre-check a decrease and a large jump before the round trip,
 * instead of only finding out from `ODOMETER_DECREASED` after the fact.
 */
export const lastOdometerQuery = (vehicleId: string | null | undefined) => ({
  queryKey: ['vehicle', vehicleId] as const,
  enabled: !!vehicleId,
  queryFn: () => api.get(url(ENDPOINTS.vehicle, { id: vehicleId! }), { schema: VehicleRecordSchema }),
  ...ttl('vehicle'),
});

/**
 * U-06 resolved: there is no driver profile endpoint, but `GET /drivers/me/onboarding` returns
 * `full_name` (plus licence and background-check state) and is own-scoped. That is the only
 * driver-readable source of a display name.
 */
export const myOnboardingQuery = {
  queryKey: ['my-onboarding'],
  queryFn: () => api.get(url(ENDPOINTS.myOnboarding), { schema: DriverOnboardingSchema }),
  ...ttl('my-onboarding'),
};

/**
 * C-07 / E-10 resolved: `GET /dashboard/vehicle-states` requires `report:read` OR `asset:read`, and
 * a DRIVER is narrowed to the vehicles of their open shift plus their assignments
 * (`ownScopeDriverId`). `next_eligible_clock_in_at` on that row IS the HOS rest-end, so the rest
 * banner has a real source. When the driver has no vehicle yet the list is empty, not an error.
 */
export const useVehicleStates = (enabled = true) => useQuery({ ...vehicleStatesQuery, enabled });

// ── vehicle CRUD (C2.1) ──────────────────────────────────────────────────────────────────────

export const useCreateVehicle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VehicleCreateInput) => api.post(url(ENDPOINTS.createVehicle), { body, schema: VehicleRecordSchema }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
  });
};

export const useUpdateVehicle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & VehicleUpdateInput) => api.patch(url(ENDPOINTS.updateVehicle, { id }), { body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
  });
};

export const useAssignVehicle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & AssignVehicleInput) => api.post(url(ENDPOINTS.assignVehicle, { id }), { body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['vehicles'] }); void qc.invalidateQueries({ queryKey: ['vehicle-states'] }); },
  });
};

// ── vehicle issues (C2.3) ────────────────────────────────────────────────────────────────────

export const useReportVehicleIssue = (vehicleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VehicleIssueCreateInput) => api.post(url(ENDPOINTS.reportVehicleIssue, { vehicleId }), { body, schema: VehicleIssueOutcomeSchema }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['vehicle-issues', vehicleId] }); },
  });
};

export const useVehicleIssues = (vehicleId: string | null | undefined) =>
  useQuery({
    queryKey: ['vehicle-issues', vehicleId],
    enabled: !!vehicleId,
    queryFn: () => api.get(url(ENDPOINTS.vehicleIssues, { vehicleId: vehicleId! }), { schema: cursorPage(VehicleIssueListRowSchema) }),
    staleTime: 30_000,
  });

// ── analytics detail (C2.5) ──────────────────────────────────────────────────────────────────

export const useAnalyticsCompany = (range?: { from?: string; to?: string }) =>
  useQuery({
    queryKey: ['analytics-company', range],
    queryFn: () => api.get(url(ENDPOINTS.analyticsCompany), { query: range, schema: CompanyAnalyticsSchema }),
    staleTime: 60_000,
  });

export const useAnalyticsManager = (userId: string | null, range?: { from?: string; to?: string }) =>
  useQuery({
    queryKey: ['analytics-manager', userId, range],
    enabled: !!userId,
    queryFn: () => api.get(url(ENDPOINTS.analyticsManager, { id: userId! }), { query: range, schema: ManagerAnalyticsSchema }),
    staleTime: 60_000,
  });

export const useAnalyticsVehicle = (vehicleId: string | null, range?: { from?: string; to?: string }) =>
  useQuery({
    queryKey: ['analytics-vehicle', vehicleId, range],
    enabled: !!vehicleId,
    queryFn: () => api.get(url(ENDPOINTS.analyticsVehicle, { id: vehicleId! }), { query: range, schema: VehicleAnalyticsDetailSchema }),
    staleTime: 60_000,
  });

export const useAnalyticsMe = (range?: { from?: string; to?: string }) =>
  useQuery({
    queryKey: ['analytics-me', range],
    queryFn: () => api.get(url(ENDPOINTS.analyticsMe), { query: range, schema: DriverAnalyticsDetailSchema }),
    staleTime: 60_000,
  });

export const useAnalyticsDriver = (driverId: string | null, range?: { from?: string; to?: string }) =>
  useQuery({
    queryKey: ['analytics-driver', driverId, range],
    enabled: !!driverId,
    queryFn: () => api.get(url(ENDPOINTS.analyticsDriver, { id: driverId! }), { query: range, schema: DriverAnalyticsDetailSchema }),
    staleTime: 60_000,
  });

// ── admin roster (C2.2) ──────────────────────────────────────────────────────────────────────

export const useAdminUsers = () =>
  useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get(url(ENDPOINTS.adminUsers), { schema: cursorPage(z.unknown()) }),
    staleTime: 30_000,
  });

export const useAdminInvitations = () =>
  useQuery({
    queryKey: ['admin-invitations'],
    queryFn: () => api.get(url(ENDPOINTS.adminInvitations), { schema: z.object({ data: z.array(z.unknown()) }) }),
    staleTime: 30_000,
  });

export const useAdminManagers = () =>
  useQuery({
    queryKey: ['admin-managers'],
    queryFn: () => api.get(url(ENDPOINTS.adminManagers), { schema: z.object({ managers: z.array(z.unknown()) }) }),
    staleTime: 30_000,
  });

export const useAdminOwnProfile = () =>
  useQuery({
    queryKey: ['admin-own-profile'],
    queryFn: () => api.get(url(ENDPOINTS.adminOwnProfile), { schema: z.object({ user_id: z.string().uuid(), email: z.string(), full_name: z.string().nullable(), phone: z.string().nullable(), locale: z.string().nullable() }) }),
    staleTime: 60_000,
  });

export const useUpdateAdminOwnProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { full_name?: string; phone?: string; locale?: string }) => api.put(url(ENDPOINTS.updateAdminOwnProfile), { body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-own-profile'] }); },
  });
};

// ── admin trigger thresholds (C2.4) ──────────────────────────────────────────────────────────

export const useAdminSettingsTriggers = () =>
  useQuery({
    queryKey: ['admin-settings-triggers'],
    queryFn: () => api.get(url(ENDPOINTS.adminSettingsTriggers), { schema: z.array(z.unknown()) }),
    staleTime: 60_000,
  });

export const useUpdateSettingsTriggers = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { key: string; value: unknown }) => api.put(url(ENDPOINTS.updateAdminSettingsTriggers), { body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-settings-triggers'] }); },
  });
};

// ── reports ───────────────────────────────────────────────────────────────────────────────────

export const useFuelEfficiencyReport = (params?: { from?: string; to?: string; vehicle_id?: string }) =>
  useQuery({
    queryKey: ['fuel-efficiency', params],
    queryFn: () => api.get(url(ENDPOINTS.fuelEfficiencyReport), { query: params, schema: z.unknown() }),
    enabled: !!params,
    staleTime: 60_000,
  });

// ── training / LMS (C2.6) ─────────────────────────────────────────────────────────────────────

export const useTrainingLessons = (cursor?: string) =>
  useQuery({
    queryKey: ['training-lessons', cursor ?? null],
    queryFn: () => api.get(url(ENDPOINTS.trainingLessons), { query: { cursor }, schema: cursorPage(TrainingLessonSchema) }),
    staleTime: 60_000,
  });

export const useTrainingLessonDetail = (id: string | null) =>
  useQuery({
    queryKey: ['training-lesson', id],
    enabled: !!id,
    queryFn: () => api.get(url(ENDPOINTS.trainingLessonDetail, { id: id! }), { schema: TrainingLessonSchema }),
    staleTime: 60_000,
  });

export const useTrainingRoster = (cursor?: string) =>
  useQuery({
    queryKey: ['training-roster', cursor ?? null],
    queryFn: () => api.get(url(ENDPOINTS.trainingRoster), { query: { cursor }, schema: cursorPage(TrainingRosterRowSchema) }),
    staleTime: 60_000,
  });

export const useCompleteTrainingLesson = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, body }: { lessonId: string; body: { quiz_score?: number } }) =>
      api.post(url(ENDPOINTS.completeTrainingLesson, { id: lessonId }), { body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['training-roster'] }); void qc.invalidateQueries({ queryKey: ['training-lessons'] }); },
  });
};

// ── maintenance (C2.7) ────────────────────────────────────────────────────────────────────────

export const useMaintenanceList = (cursor?: string) =>
  useQuery({
    queryKey: ['maintenance', cursor ?? null],
    queryFn: () => api.get(url(ENDPOINTS.maintenanceList), { query: { cursor }, schema: cursorPage(MaintenanceRecordSchema) }),
    staleTime: 60_000,
  });

export const useMaintenanceDetail = (id: string | null) =>
  useQuery({
    queryKey: ['maintenance', id],
    enabled: !!id,
    queryFn: () => api.get(url(ENDPOINTS.maintenanceDetail, { id: id! }), { schema: MaintenanceRecordSchema }),
    staleTime: 60_000,
  });

export const useCreateMaintenanceRecord = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post(url(ENDPOINTS.createMaintenanceRecord), { body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['maintenance'] }); },
  });
};

// ── privacy / DSAR (C2.8) ─────────────────────────────────────────────────────────────────────

export const useExportRequests = () =>
  useQuery({
    queryKey: ['export-requests'],
    queryFn: () => api.get(url(ENDPOINTS.exportRequests), { schema: cursorPage(z.unknown()) }),
    staleTime: 60_000,
  });

export const useCreateExportRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { notes?: string }) => api.post(url(ENDPOINTS.createExportRequest), { body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['export-requests'] }); },
  });
};

export const useExportRequestDownload = (id: string | null) =>
  useQuery({
    queryKey: ['export-download', id],
    enabled: !!id,
    queryFn: () => api.get(url(ENDPOINTS.exportRequestDownload, { id: id! }), { schema: z.object({ url: z.string().url(), expires_at: z.string().datetime() }) }),
    staleTime: 30_000,
  });

export const useTenantPrivacyRequests = () =>
  useQuery({
    queryKey: ['tenant-privacy-requests'],
    queryFn: () => api.get(url(ENDPOINTS.tenantPrivacyRequests), { schema: cursorPage(z.unknown()) }),
    staleTime: 60_000,
  });

export const useCreateDeletionRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason: string }) => api.post(url(ENDPOINTS.createDeletionRequest), { body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['export-requests'] }); },
  });
};