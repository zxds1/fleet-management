// packages/mobile/src/screens/admin/DashboardScreen.tsx
//
// Admin dashboard (flows.md C.4, spec `admin_dashboard`). Professional, data-dense landing:
// 4 summary stat cards (active fleet / pending DVIR / quarantined / expiring docs), a Critical
// Alerts column (MAYDAY + speeding) and a Live Fleet Positioning panel, plus a Recent Activity
// table. Each card routes to its screen. Presentational — data comes from `services.admin`.

import React from "react";
import { ScrollView, View } from "react-native";
import { theme } from "@/design/theme";
import { Text } from "@/design/components/Text";
import { Card } from "@/design/components/Card";
import { StatCard } from "@/design/components/StatCard";
import { Icon } from "@/design/components/Icon";
import { StatusBadge } from "@/design/components/StatusBadge";
import { DataTable, type DataTableColumn } from "@/design/components/DataTable";
import { Button } from "@/design/components/Button";
import { OfflineBanner } from "@/design/components/OfflineBanner";
import { t } from "@/core/i18n";
import type { Services } from "@/services";

export interface DashboardScreenProps {
  services: Services;
  online: boolean;
  outboxCount: number;
  onOpenOutbox: () => void;
  onNavigate: (screen: AdminNavTarget) => void;
  onAccident: (id: string) => void;
  /** Opens the full Live Map. Falls back to `onNavigate("map")` when the router does not wire it. */
  onOpenMap?: () => void;
  /** Opens the Hardware & Trackers provisioning centre. */
  onHardware?: () => void;
}

export type AdminNavTarget =
  | "map"
  | "accidents"
  | "dvir"
  | "fuel"
  | "hardware"
  | "anomalies"
  | "documents"
  | "drivers"
  | "notifications"
  | "profile";

interface ActivityRow {
  asset: string;
  event: string;
  location: string;
  time: string;
  status: string;
  tone: "success" | "neutral" | "danger";
}

export function DashboardScreen(props: DashboardScreenProps) {
  const { services, online, outboxCount, onOpenOutbox, onNavigate, onAccident, onOpenMap, onHardware } = props;
  const counts = services.admin.dashboard.counts;
  const openMap = onOpenMap ?? (() => onNavigate("map"));
  const openHardware = onHardware ?? (() => onNavigate("hardware"));

  const activity: ActivityRow[] = [
    { asset: "#TRK-902", event: t("admin.dashboard.evtRouteCompleted"), location: "Distribution Center Alpha", time: "10:45 AM", status: t("common.statusCompleted"), tone: "success" },
    { asset: "#VAN-114", event: t("admin.dashboard.evtRefuel"), location: "Station 42, Broad St", time: "10:12 AM", status: t("admin.dashboard.evtLogged"), tone: "neutral" },
    { asset: "#TRK-455", event: t("admin.dashboard.evtDvir"), location: "Depot West", time: "09:30 AM", status: t("admin.dashboard.evtDefect"), tone: "danger" },
  ];

  // Recent activity rendered as a Carbon DataTable (spec `admin_dashboard`).
  const activityColumns: DataTableColumn<ActivityRow>[] = [
    {
      key: "asset",
      header: t("admin.dashboard.colAsset"),
      flex: 1.5,
      render: (r) => <Text variant="bodyStrong" color={theme.colors.interactive01}>{r.asset}</Text>,
    },
    {
      key: "event",
      header: t("admin.dashboard.colEvent"),
      flex: 2,
      render: (r) => <Text variant="body">{r.event}</Text>,
    },
    {
      key: "location",
      header: t("admin.dashboard.colLocation"),
      flex: 2.5,
      render: (r) => <Text variant="caption" color={theme.colors.textSecondary}>{r.location}</Text>,
    },
    {
      key: "time",
      header: t("admin.dashboard.colTime"),
      flex: 1.5,
      render: (r) => <Text variant="caption" color={theme.colors.textSecondary}>{r.time}</Text>,
    },
    {
      key: "status",
      header: t("admin.dashboard.colStatus"),
      flex: 1.5,
      render: (r) => <StatusBadge label={r.status} tone={r.tone} />,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.ui01 }}>
      <OfflineBanner
        online={online}
        counts={{ pending: outboxCount, inflight: 0, failedReview: 0, done: 0, total: outboxCount }}
        onOpenOutbox={onOpenOutbox}
      />
      <ScrollView contentContainerStyle={{ padding: theme.spacing[4] }} testID="admin-dashboard">
        <Text variant="headline" style={{ marginBottom: theme.spacing[4] }}>
          {t("admin.dashboard.title")}
        </Text>

        {/* Overview summary cards */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -theme.spacing[2] }}>
          <View style={{ width: "50%", padding: theme.spacing[2] }}>
            <StatCard label={t("admin.dashboard.activeFleet")} value={String(counts.active)} tone="info" onPress={() => onNavigate("map")} />
          </View>
          <View style={{ width: "50%", padding: theme.spacing[2] }}>
            <StatCard label={t("admin.dashboard.pendingDvir")} value={String(counts.pendingDvir)} tone="warning" onPress={() => onNavigate("dvir")} />
          </View>
          <View style={{ width: "50%", padding: theme.spacing[2] }}>
            <StatCard label={t("admin.dashboard.quarantined")} value={String(counts.quarantined)} tone="danger" onPress={() => onNavigate("map")} />
          </View>
          <View style={{ width: "50%", padding: theme.spacing[2] }}>
            <StatCard label={t("admin.dashboard.expiringDocuments")} value={String(counts.expiringDocs)} tone="warning" onPress={() => onNavigate("documents")} />
          </View>
        </View>

        {/* Critical alerts + map */}
        <View style={{ marginTop: theme.spacing[4] }}>
          <Text variant="title" style={{ marginBottom: theme.spacing[3] }}>{t("admin.dashboard.criticalAlerts")}</Text>

          <Card accent={theme.colors.supportError} style={{ marginBottom: theme.spacing[3] }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: theme.spacing[2] }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Icon name="warning" filled size={theme.sizing.iconMd} color={theme.colors.supportError} />
                <Text variant="bodyStrong" color={theme.colors.supportError} style={{ marginLeft: theme.spacing[2], textTransform: "uppercase" }}>
                  {t("admin.dashboard.mayday")}
                </Text>
              </View>
              <Text variant="caption" color={theme.colors.textSecondary}>10m</Text>
            </View>
            <Text variant="subtitle" style={{ marginBottom: theme.spacing[1] }}>Vehicle #8492</Text>
            <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[3] }}>
              {t("admin.dashboard.maydayBody")}
            </Text>
            <Button variant="danger" onPress={() => onAccident("8492")}>{t("admin.dashboard.viewDetails")}</Button>
          </Card>

          <Card accent={theme.colors.supportWarning} style={{ marginBottom: theme.spacing[3] }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Icon name="speed" size={theme.sizing.iconMd} color={theme.colors.interactive01} />
                <Text variant="bodyStrong" style={{ marginLeft: theme.spacing[2] }}>{t("admin.dashboard.speeding")}</Text>
              </View>
              <Text variant="caption" color={theme.colors.textSecondary}>1h</Text>
            </View>
            <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[1] }}>
              {t("admin.dashboard.speedingBody")}
            </Text>
          </Card>
        </View>

        {/* Live Fleet Positioning (spec `admin_dashboard` map panel) */}
        <View style={{ marginTop: theme.spacing[4] }}>
          <Card
            variant="container"
            style={{ padding: 0 }}
            testID="admin-dashboard-map"
            onPress={openMap}
            accessibilityLabel={t("admin.dashboard.openLiveMap")}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                padding: theme.spacing[4],
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.ui03,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                <Icon name="map" size={theme.sizing.iconMd} color={theme.colors.interactive01} />
                <Text variant="title" style={{ marginLeft: theme.spacing[3] }}>
                  {t("admin.dashboard.livePositioning")}
                </Text>
              </View>
              <Button variant="ghost" fullWidth={false} onPress={openMap} testID="admin-dashboard-map-open">
                {t("admin.dashboard.fullMap")}
              </Button>
            </View>
            <View
              style={{
                height: 220,
                backgroundColor: theme.colors.surfaceContainer,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="map" size={theme.sizing.iconLg} color={theme.colors.textSecondary} />
              <Text variant="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
                {t("admin.dashboard.liveMapPlaceholder")}
              </Text>
            </View>
          </Card>
        </View>

        {/* Hardware & Trackers */}
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button
            variant="secondary"
            onPress={openHardware}
            icon={<Icon name="settings" size={theme.sizing.iconMd} color={theme.colors.interactive01} />}
            testID="admin-dashboard-hardware"
          >
            {t("admin.nav.hardware")}
          </Button>
        </View>

        {/* Recent activity */}
        <View style={{ marginTop: theme.spacing[4] }}>
          <Text variant="title" style={{ marginBottom: theme.spacing[3] }}>{t("admin.dashboard.recentActivity")}</Text>
          <Card variant="surface" style={{ padding: 0 }}>
            <DataTable testID="recent-activity-table" columns={activityColumns} rows={activity} />
          </Card>
        </View>

        <View style={{ height: theme.sizing.bottomNavHeight }} />
      </ScrollView>
    </View>
  );
}
