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
import { AuthService } from "../services/auth";
import { ConsentService } from "../services/consent";
import { DeviceService } from "../services/device";
import { MfaService } from "../services/mfa";
import { SessionService, type IdentityResolver } from "../services/session";
import { ShiftQuery, ShiftService } from "../services/shift";
import { FuelCardService, FuelQuery, FuelService, ReconciliationService } from "../services/fuel";
import { AccidentQuery, AccidentService } from "../services/accidents";
import { InspectionService } from "../services/inspections";
import { TrailerService } from "../services/trailer";
import { MediaService } from "../services/media";
import { AnomalyQuery, DashboardQuery, DocumentQuery } from "../services/queries";
import type { MediaPresigner } from "../media/presigner";

export interface Infra {
  env: Env;
  tokens: TokenService;
  secretBox: SecretBox;
  config: ConfigClient;
  store: SessionStore;
  presigner: MediaPresigner;
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
  trailer: TrailerService;
  media: MediaService;
  anomaly: AnomalyQuery;
  document: DocumentQuery;
  dashboard: DashboardQuery;
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
  };
}

export function makeServices(client: DbClient, infra: Infra): Services {
  const repos = makeRepositories(client);

  const resolveIdentity: IdentityResolver = async (userId) => {
    const user = await repos.users.getById(userId);
    if (!user) throw new Unauthenticated();
    const resolved = await repos.permissions.resolve(userId);
    return {
      email: user.email,
      roles: resolved.roles,
      permissions: resolved.permissions,
      locale: user.locale === "sw" ? "sw" : "en",
    };
  };

  const session = new SessionService(repos.sessions, infra.store, infra.tokens, infra.config, resolveIdentity);
  const auth = new AuthService(repos.users, repos.permissions, session, infra.tokens, infra.env);
  const mfa = new MfaService(repos.users, repos.recovery, infra.secretBox, infra.tokens, session);
  const device = new DeviceService(repos.devices, infra.tokens, infra.config);
  const consent = new ConsentService(repos.consents);
  const shift = new ShiftService(repos.shifts, repos.assignments, repos.vehicles, repos.fuelRecords, repos.workLogs, repos.hos, repos.consents);
  const shiftQuery = new ShiftQuery(repos.shifts);
  const fuel = new FuelService(repos.purchases, repos.fuelRecords);
  const fuelCard = new FuelCardService(repos.cards);
  const reconciliation = new ReconciliationService(repos.statements);
  const fuelQuery = new FuelQuery(repos.purchases.dbClient);
  const accident = new AccidentService(repos.reports, repos.accidentMedia, repos.escalationTimers, infra.config);
  const accidentQuery = new AccidentQuery(repos.reports.dbClient);
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
  const trailer = new TrailerService(repos.trailerAssignments, repos.trailers, repos.inspections);
  const media = new MediaService(repos.mediaObjects, infra.config, infra.presigner, infra.env);
  const anomaly = new AnomalyQuery(client);
  const document = new DocumentQuery(client);
  const dashboard = new DashboardQuery(client);

  return { ...repos, auth, mfa, device, consent, session, shift, shiftQuery, fuel, fuelCard, reconciliation, fuelQuery, accident, accidentQuery, inspection, trailer, media, anomaly, document, dashboard };
}

export type { PoolLike };
