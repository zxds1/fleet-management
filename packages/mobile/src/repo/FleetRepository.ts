import AsyncStorage from "@react-native-async-storage/async-storage";
import { Store } from "../store";
import { apiClient, AppError } from "../api/client";
import { config } from "../config";
import {
  type Principal,
  type ActiveShell,
  type OfflineQueueItem,
  type QueuePayloadType,
  type QueueStatus,
  type Vehicle,
  type VehicleDisplayState,
  type DriverShift,
  type RefuelPurchase,
  type InspectionReport,
  type AccidentReport,
  type AnomalyItem,
  type NotificationItem,
  type DriverRosterItem,
  type DocumentItem,
  type HardwareDevice,
  type TrainingLesson,
  type TrailerAssignment,
  type VehicleIssue,
  type VehicleMaster,
  type MaintenanceRecord,
  type PrivacyRequest,
  type AdminDashboard,
  type HosState,
  type TenantUser,
  availableShells,
} from "../data/types";

const SESSION_KEY = "fleet.session.v1";
const QUEUE_KEY = "fleet.queue.v1";
const DEVICE_KEY = "fleet.device_id_hash.v1";

export type AuthState =
  | { kind: "unauthenticated" }
  | { kind: "needs_mfa"; challengeToken: string }
  | { kind: "needs_consent"; requiredVersion: string }
  | { kind: "authenticated" }
  | { kind: "suspended" }
  | { kind: "error"; code: string; message: string };

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseIso(s: unknown): number {
  if (typeof s !== "string" && typeof s !== "number") return 0;
  const n = typeof s === "number" ? s : new Date(s).getTime();
  return Number.isNaN(n) ? 0 : n;
}

interface SessionRecord {
  accessToken: string;
  refreshToken: string;
  principalJson: string;
  deviceIdHash: string | null;
  consentVersion: string;
}

/**
 * Single source of truth for the Expo app. Live port of
 * kotlin-app/.../data/repo/FleetRepository.kt.
 *
 * Differences from the Kotlin stub: this actually hits the real Express API in
 * packages/api. Domain data starts empty and is loaded on login; an offline-first
 * queue persists enqueued writes to AsyncStorage and replays them against the
 * backend when connectivity returns (§8 of the backend contract).
 */
export class FleetRepository {
  private stores = {
    authState: new Store<AuthState>({ kind: "unauthenticated" }),
    principal: new Store<Principal | null>(null),
    activeShell: new Store<ActiveShell | null>(null),
    networkConnected: new Store<boolean>(true),
    queue: new Store<OfflineQueueItem[]>([]),

    vehicles: new Store<Vehicle[]>([]),
    activeShift: new Store<DriverShift | null>(null),
    shiftsHistory: new Store<DriverShift[]>([]),
    refuelPurchases: new Store<RefuelPurchase[]>([]),
    dvirReports: new Store<InspectionReport[]>([]),
    accidentReports: new Store<AccidentReport[]>([]),
    anomalies: new Store<AnomalyItem[]>([]),
    notifications: new Store<NotificationItem[]>([]),
    driverRoster: new Store<DriverRosterItem[]>([]),
    documents: new Store<DocumentItem[]>([]),
    hardwareDevices: new Store<HardwareDevice[]>([]),
    trainingLessons: new Store<TrainingLesson[]>([]),
    trailerAssignments: new Store<TrailerAssignment[]>([]),
    vehicleIssues: new Store<VehicleIssue[]>([]),
    vehicleMaster: new Store<VehicleMaster[]>([]),
    maintenanceRecords: new Store<MaintenanceRecord[]>([]),
    privacyRequests: new Store<PrivacyRequest[]>([]),
    adminDashboard: new Store<AdminDashboard | null>(null),
    hosState: new Store<HosState>({
      drivingMinutesToday: 0,
      dailyLimitMinutes: 660,
      restBlocked: false,
      nextEligibleClockInAt: null,
    }),
    tenantUsers: new Store<TenantUser[]>([]),
    language: new Store<string>("en"),
  };

  private deviceIdHash: string | null = null;
  private isDraining = false;
  private consentVersion: string = config.consentVersion;

  constructor() {
    this.restoreSession();
    this.loadQueue();
    this.ensureDeviceId();
  }

  // ---- store accessors (mirrors `repository.x.collectAsState()`) ----
  get authState() { return this.stores.authState; }
  get principal() { return this.stores.principal; }
  get activeShell() { return this.stores.activeShell; }
  get deviceId() { return this.deviceIdHash; }
  get isNetworkConnected() { return this.stores.networkConnected; }
  get queueItems() { return this.stores.queue; }
  get vehicles() { return this.stores.vehicles; }
  get activeShift() { return this.stores.activeShift; }
  get shiftsHistory() { return this.stores.shiftsHistory; }
  get refuelPurchases() { return this.stores.refuelPurchases; }
  get dvirReports() { return this.stores.dvirReports; }
  get accidentReports() { return this.stores.accidentReports; }
  get anomalies() { return this.stores.anomalies; }
  get notifications() { return this.stores.notifications; }
  get driverRoster() { return this.stores.driverRoster; }
  get documents() { return this.stores.documents; }
  get hardwareDevices() { return this.stores.hardwareDevices; }
  get trainingLessons() { return this.stores.trainingLessons; }
  get trailerAssignments() { return this.stores.trailerAssignments; }
  get vehicleIssues() { return this.stores.vehicleIssues; }
  get vehicleMaster() { return this.stores.vehicleMaster; }
  get maintenanceRecords() { return this.stores.maintenanceRecords; }
  get privacyRequests() { return this.stores.privacyRequests; }
  get adminDashboard() { return this.stores.adminDashboard; }
  get hosState() { return this.stores.hosState; }
  get tenantUsers() { return this.stores.tenantUsers; }
  get language() { return this.stores.language; }
  get accidents() { return this.stores.accidentReports; }
  get inspections() { return this.stores.dvirReports; }
  get fuelLogs() { return this.stores.refuelPurchases; }
  get drivers() { return this.stores.driverRoster; }
  get pendingHardware() { return this.stores.hardwareDevices; }
  get pendingPurchases() { return this.stores.refuelPurchases; }
  get notificationUnread() {
    return this.stores.notifications.get().filter((n) => !n.isRead).length;
  }

  pendingCount(): number {
    return this.stores.queue
      .get()
      .filter((i) => i.status === "PENDING" || i.status === "FAILED_REVIEW" || i.status === "INFLIGHT")
      .length;
  }

  // ====================================================================
  // SESSION PERSISTENCE
  // ====================================================================
  private async ensureDeviceId() {
    const existing = await AsyncStorage.getItem(DEVICE_KEY);
    if (existing) this.deviceIdHash = existing;
    else {
      this.deviceIdHash = uuid();
      await AsyncStorage.setItem(DEVICE_KEY, this.deviceIdHash);
    }
  }

  private async restoreSession() {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const rec = JSON.parse(raw) as SessionRecord;
      apiClient.setToken(rec.accessToken);
      const p = JSON.parse(rec.principalJson) as Principal;
      this.deviceIdHash = rec.deviceIdHash;
      this.consentVersion = rec.consentVersion;
      this.stores.principal.set(p);
      this.stores.language.set(p.locale || "en");
      this.stores.activeShell.set(availableShells(p)[0] ?? null);
      this.stores.authState.set({ kind: "authenticated" });
      this.loadAll();
    } catch {
      await AsyncStorage.removeItem(SESSION_KEY);
    }
  }

  private async persistSession() {
    const p = this.stores.principal.get();
    const token = apiClient.getToken();
    if (!p || !token) return;
    const rec: SessionRecord = {
      accessToken: token,
      refreshToken: this.refreshToken,
      principalJson: JSON.stringify(p),
      deviceIdHash: this.deviceIdHash,
      consentVersion: this.consentVersion,
    };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(rec));
  }
  private refreshToken: string = "";

  // ====================================================================
  // AUTH
  // ====================================================================
  private toPrincipal(body: Record<string, unknown>): Principal {
    const perms = Array.isArray(body.permissions) ? (body.permissions as string[]) : [];
    return {
      userId: String(body.user_id ?? ""),
      tenantId: String(body.tenant_id ?? ""),
      email: String(body.email ?? ""),
      phone: (body.phone as string) ?? null,
      roles: (Array.isArray(body.roles) ? body.roles : []) as Principal["roles"],
      permissions: new Set(perms),
      locale: String(body.locale ?? "en"),
      sessionId: (body.session_id as string) ?? null,
      deviceIdHash: this.deviceIdHash,
    };
  }

  private applyAuth(body: Record<string, unknown>) {
    apiClient.setToken(String(body.access_token));
    this.refreshToken = String(body.refresh_token ?? "");
    const principal = this.toPrincipal(body);
    this.stores.principal.set(principal);
    const shells = availableShells(principal);
    this.stores.activeShell.set(shells[0] ?? null);
    this.stores.authState.set({ kind: "authenticated" });
    this.persistSession();
    this.loadAll();
    if (principal.roles.includes("DRIVER")) this.checkConsent(principal);
  }

  private async checkConsent(principal: Principal) {
    try {
      const status = await apiClient.get<{ consented: boolean; required_version: string }>("/me/consent");
      const required = status.required_version || this.consentVersion;
      const stored = this.consentVersion;
      if (!status.consented || stored !== required) {
        this.consentVersion = required;
        this.stores.authState.set({ kind: "needs_consent", requiredVersion: required });
        this.persistSession();
      }
    } catch {
      /* consent check is best-effort; proceed */
    }
  }

  async login(identifier: string, password: string): Promise<void> {
    const isPhone = /^\+?[1-9]\d{6,14}$/.test(identifier.trim());
    const body: Record<string, unknown> = { password, device_id_hash: this.deviceIdHash };
    if (isPhone) body.phone = identifier.trim();
    else body.email = identifier.trim();

    const res = await apiClient.post<Record<string, unknown>>("/auth/login", body, undefined);
    if (res.mfa_required) {
      this.stores.authState.set({ kind: "needs_mfa", challengeToken: String(res.mfa_challenge_token) });
      return;
    }
    this.applyAuth(res);
  }

  async verifyMfa(challengeToken: string, code: string): Promise<void> {
    const res = await apiClient.post<Record<string, unknown>>(
      "/auth/mfa/verify",
      { mfa_challenge_token: challengeToken, code },
      undefined,
    );
    this.applyAuth(res);
  }

  async acceptConsent(): Promise<void> {
    await apiClient.post("/auth/consent", {
      consent_type: "terms",
      policy_version: this.consentVersion,
      accepted: true,
    });
    this.stores.authState.set({ kind: "authenticated" });
    this.persistSession();
  }

  async signupAdmin(email: string, password: string, company: string, fullName?: string): Promise<void> {
    const res = await apiClient.post<Record<string, unknown>>(
      "/auth/signup",
      { email, password, company_name: company, full_name: fullName },
      undefined,
    );
    if (res.mfa_required) {
      this.stores.authState.set({ kind: "needs_mfa", challengeToken: String(res.mfa_challenge_token) });
      return;
    }
    this.applyAuth(res);
  }

  async requestPasswordReset(identifier: string): Promise<{ resetId: string; hint: string }> {
    const res = await apiClient.post<{ reset_id: string; contact_hint: string; status: string }>(
      "/auth/password-reset/request",
      { email_or_phone: identifier.trim() },
      undefined,
    );
    return { resetId: res.reset_id, hint: res.contact_hint };
  }

  async completePasswordReset(resetId: string, code: string, newPassword: string): Promise<void> {
    await apiClient.post(`/auth/password-reset/${resetId}/complete`, { code, new_password: newPassword }, undefined);
  }

  async logout(): Promise<void> {
    try {
      await apiClient.post("/auth/logout", {});
    } catch {
      /* best-effort */
    }
    apiClient.setToken(null);
    this.refreshToken = "";
    await AsyncStorage.removeItem(SESSION_KEY);
    await AsyncStorage.removeItem(QUEUE_KEY);
    this.stores.principal.set(null);
    this.stores.activeShell.set(null);
    this.stores.authState.set({ kind: "unauthenticated" });
    this.clearDomain();
    this.stores.queue.set([]);
  }

  setActiveShell(shell: ActiveShell) {
    this.stores.activeShell.set(shell);
  }

  /**
   * DEV-ONLY: force an authenticated session without hitting the network.
   * Used by the login-screen bypass so the UI can be browsed without a backend.
   * Strips in production (callers gate on `__DEV__`).
   */
  devSetSession(p: Principal, consentVersion: string, shell?: ActiveShell, persist = false) {
    this.stores.principal.set(p);
    this.stores.language.set(p.locale || "en");
    this.stores.activeShell.set(shell ?? availableShells(p)[0] ?? null);
    this.consentVersion = consentVersion;
    this.stores.authState.set({ kind: "authenticated" });
    if (persist) this.persistSession();
  }

  setNetworkConnected(connected: boolean) {
    this.stores.networkConnected.set(connected);
    if (connected) this.drainQueue();
  }

  setLanguage(lang: string) {
    this.stores.language.set(lang);
    const p = this.stores.principal.get();
    if (p) this.stores.principal.set({ ...p, locale: lang });
  }

  setAuthError(code: string, message: string) {
    this.stores.authState.set({ kind: "error", code, message });
  }

  // ====================================================================
  // DATA LOADING (safe — swallow errors like the Kotlin `safe { }`)
  // ====================================================================
  private async safe(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      if (__DEV__) console.warn("[fleet] load failed", (e as Error).message);
    }
  }

  loadAll() {
    this.loadActiveShift();
    this.loadVehicleStates();
    this.loadNotifications();
    this.loadAnomalies();
    this.loadRefuelInbox();
    this.loadDvirInbox();
    this.loadAccidents();
    this.loadExpiringDocs();
    this.loadDriverRoster();
    this.loadHardware();
    this.loadTraining();
    this.loadTrailerAssignments();
    this.loadVehicleMaster();
    this.loadMaintenance();
    this.loadPrivacyRequests();
    this.loadAdminDashboard();
  }

  async loadActiveShift() {
    await this.safe(async () => {
      const res = await apiClient.get<Record<string, unknown> | null>("/shifts/me/active");
      this.stores.activeShift.set(
        res
          ? {
              id: String(res.shift_id),
              vehicleId: (res.vehicle_id as string) ?? null,
              assignmentId: (res.trailer_id as string) ?? null,
              clockInAt: parseIso(res.clock_in_at),
              state: "OPEN",
              todayAnomaliesCount: 0,
            }
          : null,
      );
    });
  }

  async loadVehicleStates() {
    await this.safe(async () => {
      const res = await apiClient.get<{ vehicles?: unknown[] }>("/dashboard/vehicle-states");
      const list = (res.vehicles ?? []) as Record<string, unknown>[];
      this.stores.vehicles.set(list.map((v) => this.mapVehicle(v)));
    });
  }

  private mapVehicle(v: Record<string, unknown>): Vehicle {
    const state = (v.display_state as VehicleDisplayState) || "PARKED";
    return {
      id: String(v.id ?? v.vehicle_id ?? ""),
      plateNumber: String(v.plate_number ?? v.plate ?? "?"),
      model: String(v.model ?? ""),
      vehicleClass: (v.vehicle_class as Vehicle["vehicleClass"]) || "RIGID",
      assetStatus: (v.asset_status as Vehicle["assetStatus"]) || "AVAILABLE",
      displayState: state,
      odometerKm: Number(v.odometer_km ?? 0),
      fuelLevelPct: v.fuel_level_pct == null ? null : Number(v.fuel_level_pct),
      currentDriverName: (v.current_driver_name as string) ?? null,
      lat: v.lat == null ? null : Number(v.lat),
      lng: v.lng == null ? null : Number(v.lng),
      locationName: (v.location_name as string) ?? null,
      speedKph: v.speed_kph == null ? null : Number(v.speed_kph),
      hosAlert: Boolean(v.hos_alert),
    };
  }

  async loadNotifications() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/notifications/");
      this.stores.notifications.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((n) => ({
          id: String(n.id),
          title: String(n.title ?? ""),
          message: String(n.message ?? ""),
          createdAt: parseIso(n.created_at),
          isRead: Boolean(n.is_read ?? n.read),
          priority: (n.priority as NotificationItem["priority"]) || "NORMAL",
          channel: (n.channel as NotificationItem["channel"]) || "IN_APP",
        })),
      );
    });
  }

  async loadAnomalies() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/analytics/anomalies");
      this.stores.anomalies.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((a) => ({
          id: String(a.id),
          domain: (a.domain as AnomalyItem["domain"]) || "EFFICIENCY",
          title: String(a.title ?? ""),
          detail: String(a.detail ?? ""),
          createdAt: parseIso(a.created_at),
          vehicleId: (a.vehicle_id as string) ?? null,
          severity: (a.severity as AnomalyItem["severity"]) || "WARNING",
        })),
      );
    });
  }

  async loadRefuelInbox() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/reconciliation/admin/fuel/pending");
      this.stores.refuelPurchases.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((p) => this.mapRefuel(p)),
      );
    });
  }

  private mapRefuel(p: Record<string, unknown>): RefuelPurchase {
    return {
      id: String(p.id ?? p.fuel_purchase_id ?? ""),
      vehicleId: (p.vehicle_id as string) ?? null,
      vehiclePlate: (p.vehicle_plate as string) ?? null,
      driverName: (p.driver_name as string) ?? null,
      stationName: (p.station_name as string) ?? null,
      receiptDate: (p.receipt_date as string) ?? null,
      amountSpent: p.amount_spent == null ? null : Number(p.amount_spent),
      litersPumped: p.liters_pumped == null ? null : Number(p.liters_pumped),
      odometerKm: p.odometer_km == null ? null : Number(p.odometer_km),
      distanceSinceLastRefuelKm: p.distance_since_last_refuel_km == null ? null : Number(p.distance_since_last_refuel_km),
      costPerKm: p.cost_per_km == null ? null : Number(p.cost_per_km),
      confidenceScore: p.confidence_score == null ? null : Number(p.confidence_score),
      badge: (p.badge as RefuelPurchase["badge"]) || "REVIEW",
      receiptMediaId: (p.receipt_media_object_id as string) ?? null,
      odometerPhotoMediaId: (p.odometer_photo_media_object_id as string) ?? null,
      driverCorrected: Boolean(p.driver_corrected),
      approvalStatus: (p.approval_status as RefuelPurchase["approvalStatus"]) || "PENDING",
    };
  }

  async loadDvirInbox() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/inspections/");
      this.stores.dvirReports.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((r) => this.mapInspection(r)),
      );
    });
  }

  private mapInspection(r: Record<string, unknown>): InspectionReport {
    const items = (Array.isArray(r.items) ? r.items : []) as Record<string, unknown>[];
    return {
      id: String(r.id ?? r.inspection_id ?? ""),
      vehicleId: (r.vehicle_id as string) ?? null,
      driverName: (r.driver_name as string) ?? null,
      createdAt: parseIso(r.created_at),
      subject: (r.subject as InspectionReport["subject"]) || "VEHICLE",
      overallStatus: String(r.overall_status ?? r.status ?? "PENDING"),
      defectCount: Number(r.defect_count ?? 0),
      previousDefectsReviewed: r.previous_defects_reviewed !== false,
      signatureName: String(r.signature_name ?? ""),
      items: items.map((i) => ({
        templateItemId: String(i.template_item_id ?? i.id ?? ""),
        label: String(i.label ?? ""),
        category: String(i.category ?? ""),
        result: (i.result as InspectionReport["items"][number]["result"]) || "PASS",
        severity: (i.severity as InspectionReport["items"][number]["severity"]) || "WARNING",
        numericValue: i.numeric_value == null ? null : Number(i.numeric_value),
        notes: (i.notes as string) ?? null,
        photoMediaId: (i.photo_media_object_id as string) ?? null,
      })),
      templateId: (r.template_id as string) ?? null,
      shiftId: (r.shift_id as string) ?? null,
    };
  }

  async loadAccidents() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/accidents/me");
      this.stores.accidentReports.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((a) => this.mapAccident(a)),
      );
    });
  }

  private mapAccident(a: Record<string, unknown>): AccidentReport {
    const pos = a.position as { latitude?: number; longitude?: number } | undefined;
    return {
      id: String(a.id ?? a.accident_id ?? ""),
      vehicleId: (a.vehicle_id as string) ?? null,
      driverName: (a.driver_name as string) ?? null,
      createdAt: parseIso(a.reported_at ?? a.created_at),
      isMayday: Boolean(a.is_mayday),
      status: (a.status as AccidentReport["status"]) || "PENDING",
      tierLevel: Number(a.tier_level ?? 0),
      position: pos ? { latitude: Number(pos.latitude), longitude: Number(pos.longitude) } : null,
      locationName: (a.location_name as string) ?? null,
      driverStatement: (a.driver_statement as string) ?? null,
      mediaSlots: (Array.isArray(a.media_slots) ? a.media_slots : []) as AccidentReport["mediaSlots"],
      acknowledged: Boolean(a.acknowledged),
      escalationArmed: Boolean(a.escalation_armed),
      telemetryAvailable: a.telemetry_available !== false,
    };
  }

  async loadExpiringDocs() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/documents/expiring");
      this.stores.documents.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((d) => ({
          id: String(d.id),
          title: String(d.title ?? ""),
          docType: String(d.doc_type ?? d.docType ?? ""),
          ownerName: String(d.owner_name ?? ""),
          expiresOn: (d.expires_on as string) ?? null,
          daysUntilExpiry: d.days_until_expiry == null ? null : Number(d.days_until_expiry),
        })),
      );
    });
  }

  async loadDriverRoster() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/drivers");
      this.stores.driverRoster.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((d) => ({
          id: String(d.user_id),
          name: String(d.full_name ?? d.email ?? "?"),
          phone: (d.phone as string) ?? null,
          email: (d.email as string) ?? null,
          mfaEnrolled: Boolean(d.mfa_enrolled),
          status: String(d.status ?? "ACTIVE"),
          assignedVehicleId: (d.assigned_vehicle_id as string) ?? null,
          activeSessionsCount: Number(d.active_sessions_count ?? d.active_sessions ?? 0),
        })),
      );
    });
  }

  async loadHardware() {
    await this.safe(async () => {
      const res = await apiClient.get<{ trackers?: unknown[] }>("/admin/hardware/pending");
      this.stores.hardwareDevices.set(
        ((res.trackers ?? []) as Record<string, unknown>[]).map((t) => ({
          deviceId: String(t.imei),
          vehiclePlate: (t.vehiclePlate as string) ?? null,
          brand: (t.brand as string) ?? null,
          status: (t.status as HardwareDevice["status"]) || "PENDING",
          pairedAt: parseIso(t.pairedAt),
          lastPing: parseIso(t.lastPing),
          vehicleId: (t.vehicleId as string) ?? null,
        })),
      );
    });
  }

  async loadTraining() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/training/lessons");
      this.stores.trainingLessons.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((l) => ({
          id: String(l.id ?? l.lesson_id ?? ""),
          title: String(l.title ?? ""),
          category: String(l.category ?? l.course_code ?? ""),
          durationMinutes: Number(l.duration_minutes ?? 0),
          progressPct: Number(l.progress_pct ?? 0),
          isCompleted: Boolean(l.is_completed ?? l.completed),
        })),
      );
    });
  }

  async loadTrailerAssignments() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/trailer/assignments");
      this.stores.trailerAssignments.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((t) => ({
          trailerId: String(t.trailer_id ?? ""),
          vehicleId: (t.vehicle_id as string) ?? null,
          vehiclePlate: (t.vehicle_plate as string) ?? null,
          hookedAt: (t.hooked_at as string) ?? null,
        })),
      );
    });
  }

  async loadVehicleMaster() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/vehicles");
      this.stores.vehicleMaster.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((v) => ({
          id: String(v.id),
          plateNumber: String(v.license_plate ?? v.plate ?? "?"),
          vehicleClass: String(v.vehicle_class ?? "RIGID"),
          make: (v.make as string) ?? null,
          model: (v.model as string) ?? null,
          year: v.year == null ? null : Number(v.year),
          ownershipType: (v.ownership_type as string) ?? null,
          status: String(v.status ?? "AVAILABLE"),
          isOperational: v.is_operational !== false,
          notes: (v.notes as string) ?? null,
        })),
      );
    });
  }

  async loadMaintenance() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/maintenance/");
      this.stores.maintenanceRecords.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((m) => ({
          id: String(m.id),
          assetId: (m.vehicle_id ?? m.asset_id) as string ?? null,
          assetKind: String(m.asset_kind ?? (m.trailer_id ? "TRAILER" : "VEHICLE")),
          taskCode: String(m.task_code ?? ""),
          performedAt: parseIso(m.performed_at),
          odometerKm: m.odometer_km == null ? null : Number(m.odometer_km),
          vendor: (m.vendor as string) ?? null,
          cost: m.cost == null ? null : Number(m.cost),
          currency: (m.currency as string) ?? null,
          notes: (m.notes as string) ?? null,
        })),
      );
    });
  }

  async loadPrivacyRequests() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/privacy/requests");
      this.stores.privacyRequests.set(
        ((res.data ?? []) as Record<string, unknown>[]).map((p) => ({
          id: String(p.id ?? p.request_id ?? ""),
          requestType: String(p.request_type ?? "EXPORT"),
          status: String(p.status ?? "PENDING"),
          requesterEmail: (p.email ?? p.requester_email) as string ?? null,
          createdAt: parseIso(p.created_at),
          downloadUrl: (p.download_url as string) ?? null,
        })),
      );
    });
  }

  async requestDataExport() {
    await this.safe(async () => {
      await apiClient.post("/privacy/export-request", {}, undefined);
      this.loadPrivacyRequests();
    });
  }

  async requestDataDeletion() {
    await this.safe(async () => {
      await apiClient.post("/privacy/deletion-request", {}, undefined);
      this.loadPrivacyRequests();
    });
  }

  async loadAdminDashboard() {
    await this.safe(async () => {
      const res = await apiClient.get<Record<string, unknown>>("/reports/analytics");
      this.stores.adminDashboard.set({
        tenantId: String(res.tenant_id ?? ""),
        activeFleet: Number(res.active_fleet ?? 0),
        openAccidents: Number(res.open_accidents ?? 0),
        pendingDvir: Number(res.pending_dvir ?? 0),
        expiringDocs: Number(res.expiring_docs ?? 0),
        fuelSpend30d: Number(res.fuel_spend_30d ?? 0),
        anomaliesOpen: Number(res.anomalies_open ?? 0),
      });
    });
  }

  // ====================================================================
  // OFFLINE QUEUE (persisted to AsyncStorage, §8)
  // ====================================================================
  private async loadQueue() {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw) {
      try {
        const items = JSON.parse(raw) as OfflineQueueItem[];
        // Rehydrate Set permissions are not needed here.
        this.stores.queue.set(items);
      } catch {
        /* ignore */
      }
    }
  }

  private async persistQueue() {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.stores.queue.get()));
  }

  enqueue(
    payloadType: QueuePayloadType,
    method: string,
    path: string,
    summary: string,
    bodyJson: string,
  ) {
    const item: OfflineQueueItem = {
      id: uuid(),
      idempotencyKey: uuid(),
      payloadType,
      method,
      path,
      summary,
      bodyJson,
      timestamp: Date.now(),
      attempts: 0,
      status: "PENDING",
    };
    this.stores.queue.set([item, ...this.stores.queue.get()]);
    this.persistQueue();
    if (this.stores.networkConnected.get()) this.drainQueue();
  }

  async drainQueue() {
    if (this.isDraining) return;
    this.isDraining = true;
    try {
      const items = this.stores.queue.get();
      for (const item of items) {
        if (item.status !== "PENDING" && item.status !== "FAILED_REVIEW" && item.status !== "INFLIGHT") continue;
        if (!this.stores.networkConnected.get()) break;
        this.updateQueueItem(item.id, { status: "INFLIGHT" });
        try {
          const body = JSON.parse(item.bodyJson);
          if (item.method === "POST") await apiClient.post(item.path, body, item.idempotencyKey);
          else if (item.method === "PUT") await apiClient.put(item.path, body, item.idempotencyKey);
          else if (item.method === "PATCH") await apiClient.patch(item.path, body, item.idempotencyKey);
          else if (item.method === "DELETE") await apiClient.del(item.path, item.idempotencyKey);
          this.updateQueueItem(item.id, { status: "DONE", attempts: item.attempts + 1 });
        } catch (e) {
          const code = e instanceof AppError ? e.errorCode : "NETWORK_UNAVAILABLE";
          if (code === "IDEMPOTENCY_CONFLICT") {
            this.updateQueueItem(item.id, { status: "DISCARDED", attempts: item.attempts + 1, lastErrorCode: code });
          } else if (code === "NOT_FOUND" || code === "VALIDATION_ERROR") {
            this.updateQueueItem(item.id, { status: "FAILED_REVIEW", attempts: item.attempts + 1, lastErrorCode: code, lastErrorMessage: (e as Error).message });
          } else {
            this.updateQueueItem(item.id, { status: "PENDING", attempts: item.attempts + 1, lastErrorCode: code, lastErrorMessage: (e as Error).message });
            break;
          }
        }
      }
    } finally {
      this.isDraining = false;
    }
  }

  private updateQueueItem(id: string, patch: Partial<OfflineQueueItem>) {
    this.stores.queue.set(
      this.stores.queue.get().map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
    this.persistQueue();
  }

  retryQueueItem(id: string) {
    this.updateQueueItem(id, { status: "PENDING", lastErrorCode: null, lastErrorMessage: null });
    if (this.stores.networkConnected.get()) this.drainQueue();
  }

  discardQueueItem(id: string) {
    this.stores.queue.set(this.stores.queue.get().filter((i) => i.id !== id));
    this.persistQueue();
  }

  // ====================================================================
  // BUSINESS ACTIONS (offline-first enqueue)
  // ====================================================================
  clockIn(assignmentId: string, odometerKm: number, gauge: string, mediaObjectId: string, photoFallback = false) {
    const body = {
      assignment_id: assignmentId,
      start_odometer_km: odometerKm,
      start_fuel_gauge: gauge,
      start_media_object_id: mediaObjectId,
      consent_version: this.consentVersion,
      phone_gps_fallback_enabled: photoFallback,
    };
    this.enqueue("CLOCK_IN", "POST", "/shifts/clock-in", `Clock-In (${odometerKm} km)`, JSON.stringify(body));
  }

  clockOut(shiftId: string, odometerKm: number, gauge: string, mediaObjectId: string) {
    const body = {
      shift_id: shiftId,
      end_odometer_km: odometerKm,
      end_fuel_gauge: gauge,
      end_media_object_id: mediaObjectId,
    };
    this.enqueue("CLOCK_OUT", "POST", "/shifts/clock-out", `Clock-Out (${odometerKm} km)`, JSON.stringify(body));
  }

  submitRefuel(
    vehicleId: string,
    shiftId: string | null,
    odometerReading: number,
    receiptMediaId: string,
    odometerPhotoMediaId: string,
    purchasedAt: string,
    cardLast4?: string,
  ) {
    const body = {
      shift_id: shiftId,
      vehicle_id: vehicleId,
      odometer_reading: odometerReading,
      receipt_media_object_id: receiptMediaId,
      odometer_photo_media_object_id: odometerPhotoMediaId,
      fuel_card_last_four: cardLast4,
      purchased_at: purchasedAt,
    };
    this.enqueue("REFUEL_PURCHASE", "POST", "/driver/fuel/purchase", "Refuel purchase", JSON.stringify(body));
  }

  submitDvir(
    shiftId: string,
    templateId: string,
    subject: string,
    vehicleId: string | null,
    items: { templateItemId: string; result: string; numericValue?: number | null; notes?: string | null; photo_media_object_id?: string | null }[],
    signatureName: string,
  ) {
    const body = {
      shift_id: shiftId,
      template_id: templateId,
      subject,
      vehicle_id: vehicleId,
      previous_defects_reviewed: true,
      signature_name: signatureName,
      items: items.map((i) => ({
        template_item_id: i.templateItemId,
        result: i.result,
        numeric_value: i.numericValue,
        notes: i.notes,
        photo_media_object_id: i.photo_media_object_id ?? null,
      })),
    };
    this.enqueue("DVIR_SUBMISSION", "POST", "/inspections/", "DVIR Inspection", JSON.stringify(body));
  }

  triggerMayday(shiftId: string | null, vehicleId: string | null, reason: string) {
    const body = {
      shift_id: shiftId,
      vehicle_id: vehicleId,
      position: { latitude: 0, longitude: 0 },
      mayday_reason: reason,
    };
    this.enqueue("MAYDAY_ALERT", "POST", "/accidents/mayday", "EMERGENCY MAYDAY", JSON.stringify(body));
  }

  reportAccident(shiftId: string | null, vehicleId: string | null, statement: string | null, position?: { latitude: number; longitude: number } | null, mediaObjectIds?: string[]) {
    const body = {
      shift_id: shiftId,
      vehicle_id: vehicleId,
      driver_statement: statement,
      position: position ?? null,
      media_object_ids: mediaObjectIds ?? [],
    };
    this.enqueue("ACCIDENT_REPORT", "POST", "/accidents", "Accident report", JSON.stringify(body));
  }

  reportVehicleIssue(vehicleId: string, category: string, description: string, severity: string) {
    const body = { category, description, severity };
    this.enqueue("VEHICLE_ISSUE", "POST", `/vehicles/${vehicleId}/issues`, "Vehicle issue report", JSON.stringify(body));
  }

  // ---- Training ----
  async completeTrainingLesson(id: string): Promise<void> {
    await apiClient.post(`/training/lessons/${id}/complete`, {}, undefined);
    this.loadTraining();
  }

  // ---- Admin: fuel verification ----
  async verifyPurchase(id: string, decision: "approve" | "reject", note?: string): Promise<void> {
    await apiClient.put(`/reconciliation/admin/fuel/verify/${id}`, {
      decision,
      adjusted_amount: null,
      adjusted_litres: null,
      adjusted_odometer: null,
      note: note ?? null,
    }, undefined);
    this.loadRefuelInbox();
  }

  // ---- Admin: accidents ----
  async loadAccidentsAdmin() {
    await this.safe(async () => {
      const res = await apiClient.get<{ data?: unknown[] }>("/accidents");
      if (res && res.data) {
        this.stores.accidentReports.set(
          (res.data as Record<string, unknown>[]).map((a) => this.mapAccident(a)),
        );
      }
    });
  }

  async acknowledgeAccident(id: string): Promise<void> {
    await apiClient.post(`/accidents/${id}/acknowledge`, {}, undefined);
    this.loadAccidentsAdmin();
  }

  // ---- Admin: users ----
  async suspendUser(id: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/suspend`, {}, undefined);
    this.loadDriverRoster();
  }
  async reinstateUser(id: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/reinstate`, {}, undefined);
    this.loadDriverRoster();
  }
  async revokeDevice(deviceId: string): Promise<void> {
    await apiClient.post(`/devices/${deviceId}/revoke`, {}, undefined);
    this.loadDriverRoster();
  }

  // ---- Admin: hardware ----
  async pairTracker(vehicleId: string, imei: string, brand: string, sim?: string): Promise<void> {
    await apiClient.post("/admin/hardware/pair", {
      vehicleId,
      trackerImei: imei,
      trackerBrand: brand,
      trackerSimNumber: sim ?? null,
    }, undefined);
    this.loadHardware();
  }
  async unpairTracker(vehicleId: string): Promise<void> {
    await apiClient.del(`/admin/hardware/${vehicleId}/tracker`, undefined);
    this.loadHardware();
  }

  // ---- Trailer ----
  async swapTrailer(trailerId: string, vehicleId: string | null, odometerKm?: number | null): Promise<void> {
    await apiClient.post("/trailer/swap", {
      trailer_id: trailerId,
      vehicle_id: vehicleId,
      odometer_km: odometerKm ?? null,
    }, undefined);
    this.loadTrailerAssignments();
  }

  // ---- Vehicles (Pillar 4) ----
  async createVehicle(input: {
    licensePlate: string;
    vehicleClass: string;
    make?: string;
    model?: string;
    year?: number;
  }): Promise<void> {
    await apiClient.post("/vehicles", {
      license_plate: input.licensePlate,
      vehicle_class: input.vehicleClass,
      make: input.make,
      model: input.model,
      year: input.year,
    }, undefined);
    this.loadVehicleMaster();
  }
  async updateVehicle(id: string, status: string, notes?: string): Promise<void> {
    await apiClient.patch(`/vehicles/${id}`, { status, notes }, undefined);
    this.loadVehicleMaster();
  }

  // ====================================================================
  // ADMIN / DRIVER REAL-TIME APPLIERS (kept for parity with Kotlin)
  // ====================================================================
  applyVehicleStates(rows: Vehicle[]) {
    this.stores.vehicles.set(rows);
  }
  applyNotifications(rows: NotificationItem[]) {
    this.stores.notifications.set(rows);
  }

  private clearDomain() {
    this.stores.vehicles.set([]);
    this.stores.activeShift.set(null);
    this.stores.shiftsHistory.set([]);
    this.stores.refuelPurchases.set([]);
    this.stores.dvirReports.set([]);
    this.stores.accidentReports.set([]);
    this.stores.anomalies.set([]);
    this.stores.notifications.set([]);
    this.stores.driverRoster.set([]);
    this.stores.documents.set([]);
    this.stores.hardwareDevices.set([]);
    this.stores.trainingLessons.set([]);
    this.stores.trailerAssignments.set([]);
    this.stores.vehicleIssues.set([]);
    this.stores.vehicleMaster.set([]);
    this.stores.maintenanceRecords.set([]);
    this.stores.privacyRequests.set([]);
    this.stores.adminDashboard.set(null);
    this.stores.hosState.set({ drivingMinutesToday: 0, dailyLimitMinutes: 660, restBlocked: false, nextEligibleClockInAt: null });
    this.stores.tenantUsers.set([]);
  }
}

export const repository = new FleetRepository();

