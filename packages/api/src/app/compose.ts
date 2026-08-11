// packages/api/src/app/compose.ts
// Builds request-scoped repositories + services bound to a single DbClient (the transaction client,
// D8). Infra collaborators that are client-independent (token signer, config client, session store,
// AES-GCM box) are constructed once and injected. Call makeServices(tx.client, infra) inside the
// write handler so every mutation in a request shares one transaction.

import type { DbClient } from "@fleet/shared";
import { Unauthenticated } from "@fleet/shared";
import type { Env } from "../config/env";
import type { SessionStore } from "../config/redis";
import type { PoolLike } from "@fleet/shared";
import type { ConfigClient } from "@fleet/shared";
import type { TokenService } from "../security/tokens";
import type { SecretBox } from "../security/crypto";
import {
  ConsentRepository,
  DriverDeviceRepository,
  DriverRepository,
  MfaRecoveryCodeRepository,
  PermissionRepository,
  SessionRepository,
  UserRepository,
} from "../repositories/identity";
import { AdminRepository } from "../repositories/admin";
import { OnboardingRepository } from "../repositories/onboarding";
import {
  InvitationRepository,
  ManagerAssignmentRepository,
  TenantRepository,
  TenantUserRepository,
  UserRoleRepository,
  UserTenantRepository,
} from "../repositories/tenancy";
import {
  AssignmentRepository,
  FuelRecordRepository,
  HosRepository,
  ShiftRepository,
  TrailerRepository,
  VehicleRepository,
  WorkLogRepository,
} from "../repositories/shifts";
import {
  InspectionItemPhotoRepository,
  InspectionItemRepository,
  InspectionRepository,
  InspectionTemplateItemRepository,
  InspectionTemplateRepository,
  QuarantineRepository,
} from "../repositories/inspections";
import { TrailerAssignmentRepository } from "../repositories/trailer";
import { MediaObjectRepository } from "../repositories/media";
import {
  FuelCardRepository,
  FuelPurchaseRepository,
  FuelStatementRepository,
} from "../repositories/fuel";
import {
  AccidentMediaRepository,
  AccidentReportRepository,
  EscalationTimerRepository,
} from "../repositories/accidents";
import { MaintenanceRecordRepository, MaintenanceTaskRepository } from "../repositories/maintenance";
import { VehicleIssueRepository } from "../repositories/vehicleIssue";
import {
  TrainingCourseRepository,
  TrainingEnrollmentRepository,
  TrainingLessonRepository,
} from "../repositories/training";
import { NotificationRepository } from "../repositories/notifications";
import { PrivacyRequestRepository } from "../repositories/privacy";
import { SettingsRepository } from "../repositories/settings";
import { AuthService } from "../services/auth";
import { ConsentService } from "../services/consent";
import { DeviceService } from "../services/device";
import { MfaService } from "../services/mfa";
import { SessionService, type IdentityResolver } from "../services/session";
import { ShiftQuery, ShiftService } from "../services/shift";
import { FuelCardService, FuelQuery, FuelService, ReconciliationService } from "../services/fuel";
import { AccidentQuery, AccidentService } from "../services/accidents";
import { InspectionQuery, InspectionService } from "../services/inspections";
import { TrailerService } from "../services/trailer";
import { MediaService } from "../services/media";
import { AnomalyQuery, DashboardQuery, DocumentQuery } from "../services/queries";
import { AdminService } from "../services/admin";
import { VehicleService } from "../services/vehicles";
import { AnalyticsService } from "../services/analytics";
import { TenancyService } from "../services/tenancy";
import { MaintenanceService } from "../services/maintenance";
import { VehicleIssueService } from "../services/vehicleIssue";
import { TrainingService } from "../services/training";
import { ReportsService } from "../services/reports";
import { SettingsService } from "../services/settings";
import { NotificationService } from "../services/notifications";
import { OnboardingService } from "../services/onboarding";
import { PrivacyService } from "../services/privacy";
import type { EmailService } from "../services/email";
import type { MediaPresigner } from "../media/presigner";

export interface Infra {
  env: Env;
  tokens: TokenService;
  secretBox: SecretBox;
  config: ConfigClient;
  store: SessionStore;
  presigner: MediaPresigner;
  /** Invitation delivery (14_tenancy.sql). The accept token travels by email only. */
  email: EmailService;
  /** Idle-timeout session touch (A1.6) — bumps last_seen_at on activity. */
  touchSession: (userId: string, sessionId: string) => Promise<void>;
}

export interface Repositories {
  users: UserRepository;
  permissions: PermissionRepository;
  drivers: DriverRepository;
  sessions: SessionRepository;
  devices: DriverDeviceRepository;
  consents: ConsentRepository;
  recovery: MfaRecoveryCodeRepository;
  assignments: AssignmentRepository;
  vehicles: VehicleRepository;
  workLogs: WorkLogRepository;
  fuelRecords: FuelRecordRepository;
  hos: HosRepository;
  shifts: ShiftRepository;
  purchases: FuelPurchaseRepository;
  cards: FuelCardRepository;
  statements: FuelStatementRepository;
  reports: AccidentReportRepository;
  accidentMedia: AccidentMediaRepository;
  escalationTimers: EscalationTimerRepository;
  inspections: InspectionRepository;
  inspectionItems: InspectionItemRepository;
  inspectionPhotos: InspectionItemPhotoRepository;
  inspectionTemplates: InspectionTemplateRepository;
  inspectionTemplateItems: InspectionTemplateItemRepository;
  quarantine: QuarantineRepository;
  trailers: TrailerRepository;
  trailerAssignments: TrailerAssignmentRepository;
  mediaObjects: MediaObjectRepository;
  /** Maintenance catalogue + completion log (08_safety.sql). */
  maintenanceRecords: MaintenanceRecordRepository;
  maintenanceTasks: MaintenanceTaskRepository;
  /** Driver-reported vehicle defects (14_vehicle_issues.sql). */
  vehicleIssues: VehicleIssueRepository;
  /** Training / LMS (12_training.sql). */
  trainingCourses: TrainingCourseRepository;
  trainingLessons: TrainingLessonRepository;
  trainingEnrollments: TrainingEnrollmentRepository;
  /** Recipient-facing notification inbox (09_audit_notifications.sql). */
  notifications: NotificationRepository;
  /** Runtime-tunable thresholds (app.system_config, C2.4). */
  settingsRepo: SettingsRepository;
  /** Read model for the admin driver roster (A3.7). */
  adminRepo: AdminRepository;
   /** Driver onboarding + background-check records (13_onboarding.sql). */
   onboardingRepo: OnboardingRepository;
   /** DSAR request ledger (15_privacy_requests.sql). */
   privacyRepo: PrivacyRequestRepository;
   /** Tenancy (14_tenancy.sql): companies, memberships, invitations, roles, manager scope. */
   tenants: TenantRepository;
  invitations: InvitationRepository;
  userTenants: UserTenantRepository;
  userRoles: UserRoleRepository;
  managerAssignments: ManagerAssignmentRepository;
  tenantUsers: TenantUserRepository;
}

export interface Services extends Repositories {
  auth: AuthService;
  mfa: MfaService;
  device: DeviceService;
  consent: ConsentService;
  session: SessionService;
  shift: ShiftService;
  shiftQuery: ShiftQuery;
  fuel: FuelService;
  fuelCard: FuelCardService;
  reconciliation: ReconciliationService;
  fuelQuery: FuelQuery;
  accident: AccidentService;
  accidentQuery: AccidentQuery;
  inspection: InspectionService;
  inspectionQuery: InspectionQuery;
  trailer: TrailerService;
  media: MediaService;
  anomaly: AnomalyQuery;
  document: DocumentQuery;
  dashboard: DashboardQuery;
  /** Admin console commands (A3.7): roster + device/session revoke. */
  admin: AdminService;
  /** Tenant provisioning + RBAC administration (14_tenancy.sql). */
  tenancy: TenancyService;
  /** Scope-aware hierarchical analytics (/analytics/*, aliased at /reports/*). */
  analytics: AnalyticsService;
  /** Vehicle master data + assignment (Pillar 4, /vehicles). */
  vehicle: VehicleService;
  /** Maintenance records + work orders (Pillar 3). */
  maintenance: MaintenanceService;
  /** Driver-reported vehicle issues (spec `report_vehicle_issue`). */
  vehicleIssue: VehicleIssueService;
  /** Training / LMS lessons, completion and roster (Phase 3). */
  training: TrainingService;
  /** Fuel-efficiency and operational analytics aggregates (Pillar 6). */
  report: ReportsService;
  /** Admin-editable trigger thresholds (C2.4). */
  settings: SettingsService;
  /** Recipient notification inbox (C6.4). */
  notification: NotificationService;
   /** Driver onboarding + background check. */
   onboarding: OnboardingService;
   /** Data Subject Access Request (DSAR) service (15_privacy_requests.sql). */
   privacy: PrivacyService;
}

export function makeRepositories(client: DbClient): Repositories {
  return {
    users: new UserRepository(client),
    permissions: new PermissionRepository(client),
    drivers: new DriverRepository(client),
    sessions: new SessionRepository(client),
    devices: new DriverDeviceRepository(client),
    consents: new ConsentRepository(client),
    recovery: new MfaRecoveryCodeRepository(client),
    assignments: new AssignmentRepository(client),
    vehicles: new VehicleRepository(client),
    workLogs: new WorkLogRepository(client),
    fuelRecords: new FuelRecordRepository(client),
    hos: new HosRepository(client),
    shifts: new ShiftRepository(client),
    purchases: new FuelPurchaseRepository(client),
    cards: new FuelCardRepository(client),
    statements: new FuelStatementRepository(client),
    reports: new AccidentReportRepository(client),
    accidentMedia: new AccidentMediaRepository(client),
    escalationTimers: new EscalationTimerRepository(client),
    inspections: new InspectionRepository(client),
    inspectionItems: new InspectionItemRepository(client),
    inspectionPhotos: new InspectionItemPhotoRepository(client),
    inspectionTemplates: new InspectionTemplateRepository(client),
    inspectionTemplateItems: new InspectionTemplateItemRepository(client),
    quarantine: new QuarantineRepository(client),
    trailers: new TrailerRepository(client),
    trailerAssignments: new TrailerAssignmentRepository(client),
    mediaObjects: new MediaObjectRepository(client),
    maintenanceRecords: new MaintenanceRecordRepository(client),
    maintenanceTasks: new MaintenanceTaskRepository(client),
    vehicleIssues: new VehicleIssueRepository(client),
    trainingCourses: new TrainingCourseRepository(client),
    trainingLessons: new TrainingLessonRepository(client),
    trainingEnrollments: new TrainingEnrollmentRepository(client),
    notifications: new NotificationRepository(client),
    settingsRepo: new SettingsRepository(client),
    adminRepo: new AdminRepository(client),
     onboardingRepo: new OnboardingRepository(client),
     privacyRepo: new PrivacyRequestRepository(client),
     tenants: new TenantRepository(client),
    invitations: new InvitationRepository(client),
    userTenants: new UserTenantRepository(client),
    userRoles: new UserRoleRepository(client),
    managerAssignments: new ManagerAssignmentRepository(client),
    tenantUsers: new TenantUserRepository(client),
  };
}

export function makeServices(client: DbClient, infra: Infra): Services {
  const repos = makeRepositories(client);

  const resolveIdentity: IdentityResolver = async (userId) => {
    const user = await repos.users.getById(userId);
    if (!user) throw new Unauthenticated();
    const resolved = await repos.permissions.resolve(userId);
    // The tenant is resolved from app.user_tenants (14_tenancy.sql) and signed into the JWT `tid`
    // claim, so every request is scoped from the first call after sign-in. Users predating tenancy
    // resolve to the bootstrap tenant, which is where their rows were back-filled.
    const tenantId = await repos.userTenants.findPrimaryTenantId(userId);
    return {
      // app.users.email is NOT NULL in the schema; the generated row type widens it to
      // `string | null`, so normalise here rather than leaking null into token claims.
      email: user.email ?? "",
      // Drivers sign in by phone and carry no email, so the mirrored identity keeps both.
      phone: user.phone ?? null,
      tenantId,
      roles: resolved.roles,
      permissions: resolved.permissions,
      locale: user.locale === "sw" ? "sw" : "en",
    };
  };

  const session = new SessionService(repos.sessions, infra.store, infra.tokens, infra.config, resolveIdentity);
  const mfa = new MfaService(repos.users, repos.recovery, infra.secretBox, infra.tokens, session);
  const auth = new AuthService(repos.users, repos.permissions, session, infra.tokens, infra.env);
  const device = new DeviceService(repos.devices, infra.tokens, infra.config);
  const consent = new ConsentService(repos.consents);
  const shift = new ShiftService(repos.shifts, repos.assignments, repos.vehicles, repos.fuelRecords, repos.workLogs, repos.hos, repos.consents);
  const shiftQuery = new ShiftQuery(repos.shifts);
  const fuel = new FuelService(repos.purchases, repos.fuelRecords);
  const fuelCard = new FuelCardService(repos.cards);
  const reconciliation = new ReconciliationService(repos.statements);
  const fuelQuery = new FuelQuery(repos.purchases.dbClient);
  const accident = new AccidentService(repos.reports, repos.accidentMedia, repos.escalationTimers, infra.config);
  const accidentQuery = new AccidentQuery(repos.reports.dbClient, repos.reports, repos.accidentMedia);
  const inspection = new InspectionService(
    repos.inspections,
    repos.inspectionItems,
    repos.inspectionPhotos,
    repos.inspectionTemplates,
    repos.inspectionTemplateItems,
    repos.vehicles,
    repos.trailers,
    repos.quarantine,
  );
  const inspectionQuery = new InspectionQuery(repos.inspections, repos.inspectionItems, repos.inspectionTemplates);
  const trailer = new TrailerService(repos.trailerAssignments, repos.trailers, repos.inspections);
  const media = new MediaService(repos.mediaObjects, infra.config, infra.presigner, infra.env);
  const anomaly = new AnomalyQuery(client);
  const document = new DocumentQuery(client);
  const dashboard = new DashboardQuery(client);
  const admin = new AdminService(repos.adminRepo, device, auth);
  const analytics = new AnalyticsService(client);
  const tenancy = new TenancyService(
    repos.tenants,
    repos.invitations,
    repos.userTenants,
    repos.userRoles,
    repos.managerAssignments,
    repos.tenantUsers,
    repos.users,
    infra.email,
    `${infra.env.FRONTEND_URL}/accept-invite`,
  );
  const vehicle = new VehicleService(repos.vehicles, repos.drivers, repos.assignments, repos.managerAssignments);
  const maintenance = new MaintenanceService(repos.maintenanceRecords, repos.maintenanceTasks);
  const vehicleIssue = new VehicleIssueService(repos.vehicleIssues);
  const training = new TrainingService(repos.trainingLessons, repos.trainingEnrollments);
  const report = new ReportsService(client);
  const settings = new SettingsService(repos.settingsRepo);
  const notification = new NotificationService(repos.notifications);
  const onboarding = new OnboardingService(repos.onboardingRepo, repos.drivers);
  const privacy = new PrivacyService(repos.privacyRepo, infra.presigner, infra.env.S3_MEDIA_BUCKET);

  return { ...repos, auth, mfa, device, consent, session, shift, shiftQuery, fuel, fuelCard, reconciliation, fuelQuery, accident, accidentQuery, inspection, inspectionQuery, trailer, media, anomaly, document, dashboard, admin, tenancy, analytics, onboarding, privacy, vehicle, vehicleIssue, maintenance, training, report, settings, notification };
}

export type { PoolLike };
