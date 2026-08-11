// packages/mobile/src/screens/admin/AdminRouter.tsx
//
// Post-auth admin navigation. Holds the admin sub-screen state and wires the admin core services
// (dashboard, accidents, anomalies, documents, fuel, verification, security) to the UI. Connects the
// socket as "admin" and binds the realtime feeds (map + accident live + notifications).
//
// App shell (flows.md A.6): tablet renders the persistent SideNav's 10-item drawer; phone renders a
// TopAppBar + a 5-tab BottomNav. The dashboard is the `DashboardScreen`; every other screen is
// wrapped with the shared chrome.

import React, { useEffect, useState } from "react";
import { View, ScrollView } from "react-native";
import { theme } from "@/design/theme";
import { Text } from "@/design/components/Text";
import { Button } from "@/design/components/Button";
import { OfflineBanner } from "@/design/components/OfflineBanner";
import { TopAppBar } from "@/design/components/TopAppBar";
import { BottomNav } from "@/design/components/BottomNav";
import { SideNav } from "@/design/components/SideNav";
import { Icon } from "@/design/components/Icon";
import { DashboardScreen } from "./DashboardScreen";
import { LiveMapScreen } from "./LiveMapScreen";
import { AccidentConsoleScreen } from "./AccidentConsoleScreen";
import { DvirReviewScreen } from "./DvirReviewScreen";
import { FuelReconcileScreen } from "./FuelReconcileScreen";
import { HardwareProvisioningScreen } from "./HardwareProvisioningScreen";
import { AnomalyFeedScreen } from "./AnomalyFeedScreen";
import { ExpiringDocsScreen } from "./ExpiringDocsScreen";
import { DriversScreen } from "./DriversScreen";
import { AdminNotificationsScreen } from "./AdminNotificationsScreen";
import { AdminProfileScreen } from "./AdminProfileScreen";
import { AccidentDetailScreen } from "./AccidentDetailScreen";
import { DvirReviewDetailScreen } from "./DvirReviewDetailScreen";
import { PurchaseDetailScreen } from "./PurchaseDetailScreen";
import { AnomalyDetailScreen } from "./AnomalyDetailScreen";
import { DocumentDetailScreen } from "./DocumentDetailScreen";
import { DriverDetailScreen } from "./DriverDetailScreen";
import { StatementImportScreen } from "./StatementImportScreen";
import { VehicleDetailScreen } from "./VehicleDetailScreen";
import { MaintenanceScreen } from "./MaintenanceScreen";
import { TrainingReviewScreen } from "./TrainingReviewScreen";
import { ReportsScreen } from "./ReportsScreen";
import { AnalyticsScreen } from "./AnalyticsScreen";
import { AdminManagementScreen } from "./AdminManagementScreen";
import { VehiclesScreen } from "./VehiclesScreen";
import { FuelEfficiencyScreen } from "./FuelEfficiencyScreen";
import { SettingsTriggersScreen } from "./SettingsTriggersScreen";
import { RoleSwitchScreen, type AppRole } from "../driver/RoleSwitchScreen";
import { OutboxScreen } from "../driver/OutboxScreen";
import { t, getLocale, setLocale } from "@/core/i18n";
import type { Services } from "@/services";
import type { AppError } from "@/core/error";
import type { OutboxCounts } from "@/core/offlineQueue";
import { fromUnknown } from "@/core/error";

type AdminScreen =
  | "dashboard"
  | "map"
  | "accidents"
  | "dvir"
  | "fuel"
  | "hardware"
  | "anomalies"
  | "documents"
  | "drivers"
  | "notifications"
  | "profile"
  | "accidentDetail"
  | "dvirDetail"
  | "purchaseDetail"
  | "anomalyDetail"
  | "documentDetail"
  | "driverDetail"
  | "statementImport"
  | "vehicleDetail"
  | "maintenance"
  | "training"
  | "reports"
  | "analytics"
  | "management"
  | "vehicles"
  | "fuelEfficiency"
  | "roleSwitch"
  | "outbox"
  | "settings";

export interface AdminRouterProps {
  services: Services;
  onLogout: () => void;
  /**
   * Mounts the other root navigator. `App.tsx` owns the `role` state that chooses between
   * `AdminRouter` and `DriverRouter`; this callback is `setRole(role) + setStep("authed")`, so the
   * admin surface is unmounted and the driver surface mounted in its place.
   */
  onSwitchRole?: (role: AppRole) => void;
}

const NAV: { key: AdminScreen; labelKey: string; icon: any }[] = [
  { key: "dashboard", labelKey: "admin.nav.dashboard", icon: "dashboard" },
  { key: "map", labelKey: "admin.nav.map", icon: "map" },
  { key: "accidents", labelKey: "admin.nav.accidents", icon: "report_problem" },
  { key: "dvir", labelKey: "admin.nav.dvir", icon: "fact_check" },
  { key: "fuel", labelKey: "admin.nav.fuel", icon: "local_gas_station" },
  { key: "hardware", labelKey: "admin.nav.hardware", icon: "settings" },
  { key: "anomalies", labelKey: "admin.nav.anomalies", icon: "warning" },
  { key: "documents", labelKey: "admin.nav.documents", icon: "description" },
  { key: "drivers", labelKey: "admin.nav.drivers", icon: "group" },
  { key: "notifications", labelKey: "admin.nav.notifications", icon: "notifications" },
  { key: "profile", labelKey: "admin.nav.settings", icon: "settings" },
  { key: "statementImport", labelKey: "admin.nav.statementImport", icon: "upload_file" },
  { key: "maintenance", labelKey: "admin.nav.maintenance", icon: "build" },
  { key: "training", labelKey: "admin.nav.training", icon: "school" },
  // Analytics replaces the flat "Reports" hub as the primary drill-down surface; the legacy reports
  // screen stays reachable so the fuel-efficiency link and the headline counters are not lost.
  { key: "analytics", labelKey: "admin.nav.analytics", icon: "insights" },
  { key: "management", labelKey: "admin.nav.management", icon: "group_add" },
  { key: "vehicles", labelKey: "admin.nav.vehicles", icon: "local_shipping" },
  { key: "reports", labelKey: "admin.nav.reports", icon: "bar_chart" },
  { key: "settings", labelKey: "admin.nav.alertSettings", icon: "notifications_active" },
  { key: "fuelEfficiency", labelKey: "admin.nav.fuelEfficiency", icon: "local_gas_station" },
  { key: "outbox", labelKey: "admin.nav.outbox", icon: "cloud_done" },
  { key: "roleSwitch", labelKey: "roleSwitch.title", icon: "swap_horiz" },
];

// 5-tab phone bottom nav mirrors the driver shell vocabulary where screens overlap. `outbox` keeps
// its slot: it is the only entry point to unsynced offline work on a phone (the shell OfflineBanner
// renders nothing while online and nothing needs review), so it must not be traded away. Analytics
// takes the Live Map's slot — the map is still one tap away from the dashboard's map card.
const BOTTOM: { key: AdminScreen; labelKey: string; icon: any; filledIcon?: any }[] = [
  { key: "dashboard", labelKey: "admin.nav.dashboard", icon: "home", filledIcon: "home" },
  { key: "dashboard", labelKey: "admin.nav.dashboard", icon: "home", filledIcon: "home" },
  { key: "analytics", labelKey: "admin.nav.analytics", icon: "insights" },
  { key: "vehicles", labelKey: "admin.nav.vehicles", icon: "local_shipping" },
  { key: "accidents", labelKey: "admin.nav.accidents", icon: "report_problem" },
  { key: "dvir", labelKey: "admin.nav.dvir", icon: "fact_check" },
  { key: "more" as AdminScreen, labelKey: "admin.nav.more", icon: "more_horiz" },
  { key: "more" as AdminScreen, labelKey: "admin.nav.more", icon: "more_horiz" },
];

/**
 * Phone app-bar titles. Screens absent from this map keep the dashboard title, which is the
 * pre-existing behaviour for the admin shell.
 */
const TITLE_FOR: Partial<Record<AdminScreen, string>> = {
  outbox: "outbox.title",
  analytics: "admin.analytics.title",
  management: "admin.management.title",
  vehicles: "admin.vehicles.title",
};

export function AdminRouter({ services, onLogout, onSwitchRole }: AdminRouterProps) {
  const [screen, setScreen] = useState<AdminScreen>("dashboard");
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [outboxCount, setOutboxCount] = useState(0);
  const [toast, setToast] = useState<string>();
  // Selected entity per detail screen — `renderScreen` keys off a single `screen` string, so the
  // id travels in router state and is handed to the matching detail screen.
  const [accidentId, setAccidentId] = useState<string>();
  const [verificationId, setVerificationId] = useState<string>();
  const [purchaseId, setPurchaseId] = useState<string>();
  const [anomalyId, setAnomalyId] = useState<string>();
  const [documentId, setDocumentId] = useState<string>();
  const [driverId, setDriverId] = useState<string>();
  const [vehicleId, setVehicleId] = useState<string>();

  const adminName = services.session.principal?.email ?? t("common.appName");
  const isTablet = theme.isTablet;

  useEffect(() => {
    services.socket.connect("admin");
    services.admin.dashboard.bindSocket();
    services.admin.accidents.bindSocket();
    services.admin.notifications.bindSocket();
    const sync = () => setOnline(services.socket.status === "connected");
    const offStatus = services.socket.onStatusChange(sync);
    const offDashboard = services.admin.dashboard.onChange(sync);
    const offAccidents = services.admin.accidents.onChange(() => setToast(undefined));
    void services.admin.dashboard.loadVehicles();
    sync();
    return () => {
      offStatus();
      offDashboard();
      offAccidents();
      services.admin.dashboard.dispose();
      services.admin.accidents.dispose();
      services.admin.notifications.dispose();
      services.socket.disconnect();
    };
  }, [services]);

  useEffect(() => {
    void services.queue.counts().then((c) => setOutboxCount(c.pending + c.inflight + c.failedReview));
  }, [services]);

  const navigate = (target: AdminScreen) => {
    if (target === ("more" as AdminScreen)) {
      setScreen("profile");
      return;
    }
    setScreen(target);
  };

  const body = renderScreen(screen, {
    services,
    online,
    outboxCount,
    onOpenOutbox: () => setScreen("outbox"),
    onOutboxCountsChanged: (c) => setOutboxCount(c.pending + c.inflight + c.failedReview),
    onNavigate: navigate,
    onSwitchRole,
    onAccident: () => setScreen("accidents"),
    onBack: () => setScreen("dashboard"),
    onLogout,
    email: adminName,
    ids: { accidentId, verificationId, purchaseId, anomalyId, documentId, driverId, vehicleId },
    onSelectAccident: (id) => {
      setAccidentId(id);
      setScreen("accidentDetail");
    },
    onSelectVerification: (id) => {
      setVerificationId(id);
      setScreen("dvirDetail");
    },
    onSelectPurchase: (id) => {
      setPurchaseId(id);
      setScreen("purchaseDetail");
    },
    onSelectAnomaly: (id) => {
      setAnomalyId(id);
      setScreen("anomalyDetail");
    },
    onSelectDocument: (id) => {
      setDocumentId(id);
      setScreen("documentDetail");
    },
    onSelectDriver: (id) => {
      setDriverId(id);
      setScreen("driverDetail");
    },
    onSelectVehicle: (id) => {
      setVehicleId(id);
      setScreen("vehicleDetail");
    },
    onOpenFuel: () => setScreen("fuelEfficiency"),
  });

  /**
   * Shell-level offline/needs-review banner, mirroring `DriverRouter`: the Outbox stays one tap away
   * from every admin screen. Suppressed on the dashboard (which renders its own copy inside its
   * scroll view) and on the Outbox itself.
   */
  const shellBanner =
    screen === "dashboard" || screen === "outbox" ? null : (
      <OfflineBanner
        online={online}
        counts={{ pending: outboxCount, inflight: 0, failedReview: 0, done: 0, total: outboxCount }}
        onOpenOutbox={() => setScreen("outbox")}
      />
    );

  if (isTablet) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: theme.colors.ui01 }}>
        <SideNav
          title={t("common.appName")}
          subtitle="Enterprise Control"
          items={NAV.map((n) => ({
            key: n.key,
            label: t(n.labelKey),
            icon: n.icon,
            active: screen === n.key,
            onPress: () => setScreen(n.key),
          }))}
        />
        <View style={{ flex: 1 }}>
          {shellBanner}
          <View style={{ flex: 1 }}>{body}</View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.ui01 }}>
      <TopAppBar
        title={t(TITLE_FOR[screen] ?? "admin.dashboard.title")}
        centered
        trailing={[
          { icon: "notifications", label: t("notifications.title"), onPress: () => setScreen("notifications"), badge: outboxCount > 0 },
          ...(onSwitchRole
            ? [{ icon: "swap_horiz" as const, label: t("roleSwitch.title"), onPress: () => setScreen("roleSwitch") }]
            : []),
          { icon: "settings", label: t("admin.nav.settings"), onPress: () => setScreen("profile") },
        ]}
      />
      {shellBanner}
      <View style={{ flex: 1 }}>{body}</View>
      <BottomNav
        items={BOTTOM.map((b) => ({
          key: b.key,
          label: t(b.labelKey),
          icon: b.icon,
          filledIcon: b.filledIcon,
          active: screen === b.key || (b.key === ("more" as AdminScreen) && screen === "profile"),
          onPress: () => navigate(b.key),
        }))}
      />
    </View>
  );
}

function renderScreen(
  screen: AdminScreen,
  ctx: {
    services: Services;
    online: boolean;
    outboxCount: number;
    onOpenOutbox: () => void;
    onOutboxCountsChanged: (counts: OutboxCounts) => void;
    onNavigate: (s: AdminScreen) => void;
    onSwitchRole?: (role: AppRole) => void;
    onAccident: (id: string) => void;
    onBack: () => void;
    onLogout: () => void;
    email: string;
    ids: {
      accidentId?: string;
      verificationId?: string;
      purchaseId?: string;
      anomalyId?: string;
      documentId?: string;
      driverId?: string;
      vehicleId?: string;
    };
    onSelectAccident: (id: string) => void;
    onSelectVerification: (id: string) => void;
    onSelectPurchase: (id: string) => void;
    onSelectAnomaly: (id: string) => void;
    onSelectDocument: (id: string) => void;
    onSelectDriver: (id: string) => void;
    onSelectVehicle: (id: string) => void;
    onOpenFuel: () => void;
  },
): React.ReactElement {
  const {
    services,
    online,
    outboxCount,
    onOpenOutbox,
    onOutboxCountsChanged,
    onNavigate,
    onSwitchRole,
    onAccident,
    onBack,
    onLogout,
    email,
    ids,
    onSelectAccident,
    onSelectVerification,
    onSelectPurchase,
    onSelectAnomaly,
    onSelectDocument,
    onSelectDriver,
    onSelectVehicle,
    onOpenFuel,
  } = ctx;
  switch (screen) {
    case "dashboard":
      return (
        <DashboardScreen
          services={services}
          online={online}
          outboxCount={outboxCount}
          onOpenOutbox={onOpenOutbox}
          onNavigate={onNavigate}
          onAccident={onAccident}
          onOpenMap={() => onNavigate("map")}
          onHardware={() => onNavigate("hardware")}
        />
      );
    case "map":
      return <LiveMapScreen services={services} offline={!online} onBack={onBack} onSelectVehicle={onSelectVehicle} />;
    case "accidents":
      return <AccidentConsoleScreen services={services} offline={!online} onBack={onBack} onSelectAccident={onSelectAccident} />;
    case "dvir":
      return <DvirReviewScreen services={services} onBack={onBack} onSelect={onSelectVerification} />;
    case "fuel":
      return <FuelReconcileScreen services={services} onBack={onBack} onSelect={onSelectPurchase} />;
    case "hardware":
      return <HardwareProvisioningScreen services={services} onBack={onBack} />;
    case "anomalies":
      return <AnomalyFeedScreen services={services} onBack={onBack} onSelect={onSelectAnomaly} />;
    case "documents":
      return <ExpiringDocsScreen services={services} onBack={onBack} onSelect={onSelectDocument} />;
    case "drivers":
      return <DriversScreen services={services} onBack={onBack} onSelect={onSelectDriver} />;
    case "notifications":
      return <AdminNotificationsScreen services={services} onBack={onBack} />;
    case "profile":
      return <AdminProfileScreen services={services} email={email} onLogout={onLogout} onBack={onBack} />;
    case "accidentDetail":
      return <AccidentDetailScreen services={services} id={ids.accidentId} onBack={() => onNavigate("accidents")} />;
    case "dvirDetail":
      return <DvirReviewDetailScreen services={services} id={ids.verificationId} onBack={() => onNavigate("dvir")} />;
    case "purchaseDetail":
      return <PurchaseDetailScreen services={services} id={ids.purchaseId} onBack={() => onNavigate("fuel")} />;
    case "anomalyDetail":
      return <AnomalyDetailScreen services={services} id={ids.anomalyId} onBack={() => onNavigate("anomalies")} />;
    case "documentDetail":
      return <DocumentDetailScreen services={services} id={ids.documentId} onBack={() => onNavigate("documents")} />;
    case "driverDetail":
      return <DriverDetailScreen services={services} id={ids.driverId} onBack={() => onNavigate("drivers")} />;
    case "statementImport":
      return (
        <StatementImportScreen
          onPickFile={() => {}}
          onBack={onBack}
        />
      );
    case "vehicleDetail":
      return (
        <VehicleDetailScreen
          services={services}
          id={ids.vehicleId}
          onBack={() => onNavigate("map")}
          onSelectDocument={onSelectDocument}
        />
      );
    case "maintenance":
      return <MaintenanceScreen services={services} onBack={onBack} onSelectVehicle={onSelectVehicle} />;
    case "training":
      return <TrainingReviewScreen services={services} onBack={onBack} />;
    case "reports":
      return <ReportsScreen services={services} onBack={onBack} onOpenFuel={onOpenFuel} />;
    case "analytics":
      // Self-scoping: the screen resolves company / manager / driver from the principal's roles, so
      // the same route is safe for every signed-in user.
      return <AnalyticsScreen services={services} onBack={onBack} onOpenFuel={onOpenFuel} />;
    case "management":
      return <AdminManagementScreen services={services} onBack={onBack} />;
    case "vehicles":
      return (
        <VehiclesScreen
          services={services}
          onBack={onBack}
          onSelect={onSelectVehicle}
        />
      );
    case "fuelEfficiency":
      return <FuelEfficiencyScreen services={services} onBack={onBack} onSelectVehicle={onSelectVehicle} />;
    case "settings":
      return <SettingsTriggersScreen services={services} onBack={onBack} />;
    case "outbox":
      // Reuses the driver Outbox verbatim: the offline queue is a shared, role-agnostic service.
      return (
        <OutboxScreen
          services={services}
          online={online}
          onCountsChanged={onOutboxCountsChanged}
          onBack={onBack}
        />
      );
    case "roleSwitch":
      // `App.tsx` re-mounts the matching root navigator from its `role` state; picking "admin" here
      // is a no-op switch that returns to the dashboard.
      return (
        <RoleSwitchScreen
          currentRole="admin"
          onSwitch={(role) => {
            if (role === "admin") onNavigate("dashboard");
            onSwitchRole?.(role);
          }}
          locale={getLocale()}
          onSwitchLocale={(l) => setLocale(l)}
        />
      );
    default:
      return (
        <NotFoundScreen
          onAction={() => onNavigate("dashboard")}
          testID="admin-not-found"
        />
      );
  }
}


