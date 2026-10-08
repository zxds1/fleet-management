/**
 * EVERY HTTP endpoint the app calls, in one place.
 *
 * Transcribed from the backend routers, which are the source of truth:
 *   packages/api/src/app/app.ts                       (mount points + base path)
 *   packages/api/src/http/routes/{auth,admin,shifts,fuel,inspections,accidents,trailer,media,
 *     notifications,me,onboarding,insights,vehicles,vehicleIssue,privacy,settings,training,
 *     maintenance,reports,analytics,hardware,telemetry}.ts
 *   packages/ws/src/gateway.ts                        (realtime, not HTTP)
 *
 * `status`:
 *   CONTRACT  the router declares this exact path + method (verified against the route file)
 *   ASSUMED   no route exists; invented to make a screen work. `assumption` points at docs/ASSUMPTIONS.md
 *
 * `permission` is what the route's `requirePermission(...)` demands. The UI gates on the same code,
 * so a control can never be offered to someone the server will 403.
 *
 * Screens never write a path literal: they call `url(ENDPOINTS.x, { id })`. `test/assumptions.test.ts`
 * enforces that, and that every ASSUMED entry is documented.
 */
export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type EndpointStatus = 'CONTRACT' | 'ASSUMED';

export interface Endpoint {
  method: Method;
  template: string;
  status: EndpointStatus;
  /** The permission the route enforces, or null when it needs only a valid session. */
  permission?: string;
  assumption?: string;
}

const ep = (
  method: Method,
  template: string,
  permission: string | null = null,
  extra: { status?: EndpointStatus; assumption?: string } = {},
): Endpoint => ({
  method,
  template,
  status: extra.status ?? 'CONTRACT',
  ...(permission ? { permission } : {}),
  ...(extra.assumption ? { assumption: extra.assumption } : {}),
});

export const ENDPOINTS = {
  // ── auth / session ───────────────────────────────────────────────────────────────────────
  login: ep('POST', '/auth/login'),
  signup: ep('POST', '/auth/signup'),
  mfaVerify: ep('POST', '/auth/mfa/verify'),
  refresh: ep('POST', '/auth/refresh'),
  logout: ep('POST', '/auth/logout'),
  logoutAll: ep('POST', '/auth/logout-all'),
  changePassword: ep('POST', '/auth/change-password'),
  mfaEnroll: ep('POST', '/auth/mfa/enroll', 'manage_own_mfa'),
  passwordResetRequest: ep('POST', '/auth/password-reset/request'),
  passwordResetApprove: ep('POST', '/auth/password-reset/{resetId}/approve', 'admin'),
  passwordResetComplete: (resetId: string) => ep('POST', `/auth/password-reset/${resetId}/complete`),
  acceptInvite: ep('POST', '/auth/accept-invite'),

  // ── devices (registration happens AFTER login; there is no DEVICE_UNKNOWN gate) ───────────
  registerDevice: ep('POST', '/auth/devices'),
  setPin: ep('POST', '/auth/devices/pin'),
  refreshDeviceToken: ep('POST', '/auth/devices/refresh'),

  // ── consent ───────────────────────────────────────────────────────────────────────────────
  consentStatus: ep('GET', '/me/consent'),
  /**
   * openapi.yaml documents `POST /consent`, but the route is declared inside `auth.ts`, which app.ts
   * mounts at `${base}/auth` — so the path that actually answers is `/auth/consent`. Recorded as a
   * spec-vs-router drift in docs/ASSUMPTIONS.md (D-03).
   */
  acceptConsent: ep('POST', '/auth/consent'),

  // ── driver self-service ──────────────────────────────────────────────────────────────────
  myAssignment: ep('GET', '/drivers/me/assignment', 'assignment:read'),
  myOnboarding: ep('GET', '/drivers/me/onboarding', 'onboarding:read'),
  saveOnboardingProfile: ep('POST', '/drivers/me/onboarding/profile', 'onboarding:submit'),
  submitBackgroundCheck: ep('POST', '/drivers/me/background-check', 'onboarding:submit'),
  myTrainingStatus: ep('GET', '/drivers/me/training-status', 'training:read'),

  // ── shifts ────────────────────────────────────────────────────────────────────────────────
  clockIn: ep('POST', '/shifts/clock-in', 'shift:clock_in'),
  clockOut: ep('POST', '/shifts/clock-out', 'shift:clock_out'),
  activeShift: ep('GET', '/shifts/me/active', 'shift:read_own'),
  myShifts: ep('GET', '/shifts/me', 'shift:read_own'),
  shiftInbox: ep('GET', '/shifts/verification-inbox', 'shift:read_all'),
  shiftVerification: ep('GET', '/shifts/{id}/verification', 'shift:read_all'),
  shiftWorkPlan: ep('GET', '/shifts/{id}/work-plan', 'shift:read_all'),
  verifyShift: ep('POST', '/shifts/{id}/verify', 'shift:verify'),
  forceCloseShift: ep('POST', '/shifts/{id}/force-close', 'shift:force_close'),

  // ── fuel ──────────────────────────────────────────────────────────────────────────────────
  fuelCards: ep('POST', '/fuel/cards', 'fuel:card_manage'),
  /** U-05: the refuel card picker. `asset:read` (a DRIVER permission), not `fuel:card_manage`. */
  selectableFuelCards: ep('GET', '/fuel/cards', 'asset:read'),
  fuelInbox: ep('GET', '/fuel/reconciliation-inbox', 'fuel:read'),
  verifyFuel: ep('POST', '/fuel/purchases/{id}/verify', 'fuel:verify'),
  /** The refuel flow a driver can actually complete (A1.4). */
  driverFuelPurchase: ep('POST', '/driver/fuel/purchase', 'fuel:submit_purchase'),
  driverFuelCorrect: ep('POST', '/driver/fuel/correct', 'fuel:submit_purchase'),
  driverFuelOcr: ep('GET', '/driver/fuel/purchase/{id}/ocr', 'fuel:submit_purchase'),
  adminFuelPending: ep('GET', '/admin/fuel/pending', 'fuel:read'),
  adminFuelVerify: ep('PUT', '/admin/fuel/verify/{id}', 'fuel:verify'),
  importStatement: ep('POST', '/reconciliation/statements', 'fuel:reconcile'),

  // ── inspections ───────────────────────────────────────────────────────────────────────────
  submitInspection: ep('POST', '/inspections', 'inspection:submit'),
  inspectionTemplates: ep('GET', '/inspections/templates', 'inspection:read'),
  myInspections: ep('GET', '/inspections/me', 'inspection:read'),
  inspections: ep('GET', '/inspections', 'inspection:read'),
  inspection: ep('GET', '/inspections/{id}', 'inspection:read'),

  // ── accidents ─────────────────────────────────────────────────────────────────────────────
  mayday: ep('POST', '/accidents/mayday', 'accident:report'),
  submitAccident: ep('POST', '/accidents', 'accident:report'),
  myAccidents: ep('GET', '/accidents/me', 'accident:read'),
  accidentMedia: ep('POST', '/accidents/{id}/media', 'accident:report'),
  acknowledgeAccident: ep('POST', '/accidents/{id}/acknowledge', 'accident:acknowledge'),
  verifyTelemetry: ep('GET', '/accidents/{id}/telemetry/verify', 'accident:read'),
  accident: ep('GET', '/accidents/{id}', 'accident:read'),

  // ── trailer ──────────────────────────────────────────────────────────────────────────────
  trailerSwap: ep('POST', '/trailer/swap', 'trailer:swap'),
  /**
   * U-03: the hook picker. Guarded by `trailer:swap`, so only someone who may swap can browse.
   * Note the path is SINGULAR: `app.ts` mounts the trailer router at `${base}/trailer`, alongside
   * `POST /trailer/swap`, so this is `GET /trailer` and not `/trailers`.
   */
  trailers: ep('GET', '/trailer', 'trailer:swap'),

  // ── media ─────────────────────────────────────────────────────────────────────────────────
  uploadUrl: ep('POST', '/media/upload-url'),
  /** Answers 302 to a short-lived presigned GET, not JSON. */
  mediaObject: ep('GET', '/media/{id}'),

  /**
   * U-01: phone-GPS ingest for when the vehicle's tracker is silent. Authenticated; the vehicle comes
   * from the caller's OPEN shift, never from the body, and the server caps the batch and its age.
   */
  phonePoints: ep('POST', '/telemetry/points'),

  // ── dashboard / insights ──────────────────────────────────────────────────────────────────
  vehicleStates: ep('GET', '/dashboard/vehicle-states', 'report:read'),
  anomalies: ep('GET', '/anomalies', 'report:read'),
  /** The only endpoint with exact counts (S-08): `report:read`, ADMIN + FLEET_MANAGER. */
  analytics: ep('GET', '/reports/analytics', 'report:read'),
  anomaly: ep('GET', '/anomalies/{id}', 'anomaly:read'),
  expiringDocs: ep('GET', '/documents/expiring', 'document:read'),
  docDetail: ep('GET', '/documents/{id}', 'document:read'),
  setRenewalNote: ep('POST', '/documents/{id}/renewal-note', 'document:manage'),

  // ── notifications ─────────────────────────────────────────────────────────────────────────
  notifications: ep('GET', '/notifications', 'notification:read'),
  /** S-08: the only exact counts for the inbox badge. */
  notificationCount: ep('GET', '/notifications/count', 'notification:read'),
  markRead: ep('POST', '/notifications/{id}/read', 'notification:read'),
  markAllRead: ep('POST', '/notifications/read-all', 'notification:read'),

  // ── admin: people and devices ─────────────────────────────────────────────────────────────
  drivers: ep('GET', '/drivers', 'user:read'),
  driverDetail: ep('GET', '/drivers/{id}', 'user:read'),
  createDriver: ep('POST', '/drivers', 'user:manage'),
  approveDriver: ep('POST', '/drivers/{id}/approve', 'user:manage'),
  suspendUser: ep('POST', '/admin/users/{id}/suspend', 'user:manage'),
  reinstateUser: ep('POST', '/admin/users/{id}/reinstate', 'user:manage'),
  revokeSessions: ep('POST', '/sessions/revoke', 'user:manage'),
  revokeDevice: ep('POST', '/devices/{deviceId}/revoke', 'device:revoke'),
  /** Self-revoke path (`REVOKE_DEVICE` permission on the caller's own hash). */
  revokeOwnDevice: ep('POST', '/auth/devices/revoke', 'revoke_device'),

  // ── vehicles ──────────────────────────────────────────────────────────────────────────────
  vehicles: ep('GET', '/vehicles', 'asset:read'),
  vehicle: ep('GET', '/vehicles/{id}', 'asset:read'),
  createVehicle: ep('POST', '/vehicles', 'asset:create'),
  updateVehicle: ep('PATCH', '/vehicles/{id}', 'asset:update'),
  assignVehicle: ep('POST', '/vehicles/{id}/assign', 'asset:update'),

  // ── vehicle issues (driver-reported defects) ──────────────────────────────────────────────
  reportVehicleIssue: ep('POST', '/vehicles/{vehicleId}/issues', 'vehicle:report'),
  vehicleIssues: ep('GET', '/vehicles/{vehicleId}/issues', 'asset:read'),

  // ── analytics detail (hierarchical drill-down from /reports/analytics) ─────────────────────
  analyticsCompany: ep('GET', '/analytics/company', 'fuel:read'),
  analyticsManager: ep('GET', '/analytics/manager/{id}', 'fuel:read'),
  analyticsVehicle: ep('GET', '/analytics/vehicle/{id}', 'fuel:read'),
  analyticsMe: ep('GET', '/analytics/me', 'fuel:read'),
  analyticsDriver: ep('GET', '/analytics/driver/{id}', 'fuel:read'),

  // ── admin roster / tenancy ────────────────────────────────────────────────────────────────
  adminUsers: ep('GET', '/admin/users', 'user:read'),
  adminInvitations: ep('GET', '/admin/invitations', 'user:read'),
  inviteUser: ep('POST', '/admin/users/invite', 'user:manage'),
  adminManagers: ep('GET', '/admin/managers', 'user:read'),
  adminManagersAssign: ep('POST', '/admin/managers/{userId}/assign', 'user:manage'),
  adminUsersAssign: ep('POST', '/admin/users/{userId}/assign', 'user:manage'),
  adminUsersRevokeRole: ep('POST', '/admin/users/{userId}/roles/revoke', 'user:manage'),
  adminOwnProfile: ep('GET', '/admin/users/me', 'user:manage'),
  updateAdminOwnProfile: ep('PUT', '/admin/users/me', 'user:manage'),

  // ── admin trigger thresholds (C2.4) ─────────────────────────────────────────────────────
  adminSettingsTriggers: ep('GET', '/admin/settings/triggers', 'config:read'),
  updateAdminSettingsTriggers: ep('PUT', '/admin/settings/triggers', 'config:manage'),

  // ── reports ───────────────────────────────────────────────────────────────────────────────
  fuelEfficiencyReport: ep('GET', '/reports/fuel-efficiency', 'report:read'),

  // ── training / LMS ────────────────────────────────────────────────────────────────────────
  trainingLessons: ep('GET', '/training/lessons', 'training:read'),
  trainingLessonDetail: ep('GET', '/training/lessons/{id}', 'training:read'),
  trainingRoster: ep('GET', '/training/roster', 'training:review'),
  completeTrainingLesson: ep('POST', '/training/lessons/{id}/complete', 'training:complete'),

  // ── maintenance ───────────────────────────────────────────────────────────────────────────
  maintenanceList: ep('GET', '/maintenance', 'maintenance:read'),
  maintenanceDetail: ep('GET', '/maintenance/{id}', 'maintenance:read'),
  createMaintenanceRecord: ep('POST', '/maintenance/work-orders', 'maintenance:record'),

  // ── privacy / DSAR ────────────────────────────────────────────────────────────────────────
  exportRequests: ep('GET', '/privacy/export-request', 'privacy:request_own'),
  createExportRequest: ep('POST', '/privacy/export-request', 'privacy:request_own'),
  exportRequestDownload: ep('GET', '/privacy/export-request/{id}/download', 'privacy:request_own'),
  tenantPrivacyRequests: ep('GET', '/privacy/requests', 'privacy:view_requests_tenant'),
  createDeletionRequest: ep('POST', '/privacy/deletion-request', 'privacy:request_own'),

  // ── hardware / tracker provisioning (A1.1) ──────────────────────────────────────────────
  hardwarePair: ep('POST', '/admin/hardware/pair', 'asset:update'),
  hardwareUnpair: ep('DELETE', '/admin/hardware/{vehicleId}/tracker', 'asset:update'),
  hardwarePending: ep('GET', '/admin/hardware/pending', 'asset:read'),
} as const satisfies Record<string, Endpoint | ((args: string) => Endpoint)>;

export type EndpointKey = keyof typeof ENDPOINTS;

/** Fills `{id}`-style placeholders with URL-encoded values. A missing value is a programming error. */
export function url(e: Endpoint, params: Record<string, string> = {}): string {
  return e.template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined || v === '') throw new Error(`Missing "${k}" for ${e.template}`);
    return encodeURIComponent(v);
  });
}

export const ALL_ENDPOINTS: { key: string; endpoint: Endpoint }[] = Object.entries(ENDPOINTS).flatMap(([key, endpoint]) => (typeof endpoint === 'function' ? [] : [{ key, endpoint: endpoint as Endpoint }]));

/** Endpoints with no matching route in the backend: each must name a ledger entry. */
export const ASSUMED_ENDPOINT_KEYS = ALL_ENDPOINTS.filter((e) => e.endpoint.status !== 'CONTRACT').map((e) => e.key);