// packages/mobile/src/screens/driver/DriverHomeScreen.tsx
//
// Post-auth driver landing hub (flows.md B.4, spec `driver_home_1/2`). Hero with shift CTA, a
// vehicle-status bento (assignment card + map snapshot), and an icon-driven quick-actions grid.
// Presentational — navigation + data flow come from the router. All copy via i18n (D-10).

import React from "react";
import { View, ScrollView, TouchableOpacity } from "react-native";
import { theme } from "@/design/theme";
import { Text } from "@/design/components/Text";
import { Button } from "@/design/components/Button";
import { Card } from "@/design/components/Card";
import { StatusBadge } from "@/design/components/StatusBadge";
import { DisplayStateBadge } from "@/design/components/StatusBadge";
import { Icon } from "@/design/components/Icon";
import { OfflineBanner } from "@/design/components/OfflineBanner";
import { t } from "@/core/i18n";
import type { ActiveShift } from "@/core/driver/shifts";
import type { DisplayState } from "@/design/tokens";

export interface DriverHomeScreenProps {
  driverName: string;
  activeShift: ActiveShift | null;
  pendingCloseout: boolean;
  offline: boolean;
  outboxCount: number;
  onClockIn: () => void;
  onClockOut: () => void;
  onRefuel: () => void;
  onInspect: () => void;
  onAccident: () => void;
  onNotifications: () => void;
  onAnomalies: () => void;
  onVehicle: () => void;
  onTraining: () => void;
  onResources: () => void;
  onProfile: () => void;
  onOpenOutbox: () => void;
}

const QUICK: { key: string; labelKey: string; icon: any; onPressKey: keyof DriverHomeScreenProps; danger?: boolean }[] = [
  { key: "refuel", labelKey: "driver.tabs.refuel", icon: "local_gas_station", onPressKey: "onRefuel" },
  { key: "inspect", labelKey: "driver.tabs.inspect", icon: "fact_check", onPressKey: "onInspect" },
  { key: "accident", labelKey: "driver.tabs.accidents", icon: "report_problem", onPressKey: "onAccident", danger: true },
  { key: "vehicle", labelKey: "driver.vehicle.title", icon: "local_shipping", onPressKey: "onVehicle" },
  { key: "training", labelKey: "driver.tabs.training", icon: "school", onPressKey: "onTraining" },
  { key: "resources", labelKey: "driver.tabs.resources", icon: "menu_book", onPressKey: "onResources" },
  { key: "anomalies", labelKey: "driver.anomalies.title", icon: "warning", onPressKey: "onAnomalies" },
  { key: "profile", labelKey: "driver.profile.title", icon: "person", onPressKey: "onProfile" },
];

export function DriverHomeScreen(props: DriverHomeScreenProps) {
  const { driverName, activeShift, pendingCloseout, offline, outboxCount } = props;
  const state: DisplayState[] = activeShift ? ["MOVING"] : ["PARKED"];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.ui01 }}>
      <OfflineBanner
        online={!offline}
        counts={{ pending: outboxCount, inflight: 0, failedReview: 0, done: 0, total: outboxCount }}
        onOpenOutbox={props.onOpenOutbox}
      />
      <ScrollView contentContainerStyle={{ padding: theme.spacing[4] }}>
        {/* Hero */}
        <Card variant="container" style={{ marginBottom: theme.spacing[4] }}>
          <Text variant="headline" style={{ marginBottom: theme.spacing[1] }}>
            {t("driver.home.greeting", { name: driverName })}
          </Text>
          <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[4] }}>
            {t("driver.home.subtitle")}
          </Text>
          <Button icon={<Icon name="schedule" size={20} color={theme.colors.onPrimary} />} onPress={activeShift ? props.onClockOut : props.onClockIn}>
            {activeShift ? t("driver.home.clockOut") : t("driver.home.clockIn")}
          </Button>
        </Card>

        {/* Vehicle status bento */}
        <View style={{ flexDirection: "row", gap: theme.spacing[3], marginBottom: theme.spacing[4] }}>
          <View style={{ flex: 2 }}>
            <Card variant="container" style={{ marginBottom: 0 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View>
                  <Text variant="label" color={theme.colors.textSecondary} style={{ textTransform: "uppercase" }}>
                    {t("driver.home.currentAssignment")}
                  </Text>
                  <Text variant="subtitle" style={{ marginTop: theme.spacing[1] }}>
                    {activeShift ? t("driver.home.assignment", { id: activeShift.vehicle_id.slice(0, 8) }) : t("driver.home.noActiveShift")}
                  </Text>
                </View>
                <DisplayStateBadge states={state} labelFor={(s) => t(`displayState.${s}`)} />
              </View>
              <View style={{ flexDirection: "row", gap: theme.spacing[5], marginTop: theme.spacing[3], borderTopWidth: 1, borderTopColor: theme.colors.ui03, paddingTop: theme.spacing[3] }}>
                <View>
                  <Text variant="caption" color={theme.colors.textSecondary}>{t("driver.home.fuelLevel")}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[1], marginTop: 2 }}>
                    <Icon name="local_gas_station" size={18} color={theme.colors.success} />
                    <Text variant="bodyStrong">78%</Text>
                  </View>
                </View>
                <View>
                  <Text variant="caption" color={theme.colors.textSecondary}>{t("driver.home.nextMaintenance")}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[1], marginTop: 2 }}>
                    <Icon name="build" size={18} color={theme.colors.secondary} />
                    <Text variant="bodyStrong">1,200 mi</Text>
                  </View>
                </View>
              </View>
            </Card>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={props.onVehicle}
            style={{ flex: 1, backgroundColor: theme.colors.ui02, borderRadius: 0, minHeight: 140, overflow: "hidden", justifyContent: "flex-end" }}
          >
            <View style={{ position: "absolute", top: theme.spacing[3], left: theme.spacing[3] }}>
              <Icon name="location_on" size={18} color={theme.colors.interactive01} />
            </View>
            <View style={{ backgroundColor: theme.colors.surface, padding: theme.spacing[2] }}>
              <Text variant="label" style={{ flexDirection: "row" }}>
                {t("driver.home.yard")}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Quick actions */}
        <Text variant="title" style={{ marginBottom: theme.spacing[3], borderBottomWidth: 1, borderBottomColor: theme.colors.ui03, paddingBottom: theme.spacing[2] }}>
          {t("driver.home.quickActions")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -theme.spacing[2] }}>
          {QUICK.map((q) => (
            <View key={q.key} style={{ width: "33.33%", padding: theme.spacing[2] }}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={props[q.onPressKey] as () => void}
                style={{
                  backgroundColor: q.danger ? theme.colors.errorContainer : theme.colors.surfaceContainer,
                  borderWidth: q.danger ? 0 : 1,
                  borderColor: q.danger ? "transparent" : theme.colors.outlineVariant,
                  padding: theme.spacing[4],
                  minHeight: 96,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Icon name={q.icon} size={28} color={q.danger ? theme.colors.error : theme.colors.primary} />
                <Text
                  variant="bodyStrong"
                  color={q.danger ? theme.colors.onErrorContainer : theme.colors.onSurface}
                  style={{ marginTop: theme.spacing[2], textAlign: "center" }}
                >
                  {t(q.labelKey)}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {pendingCloseout && (
          <StatusBadge tone="warning" label={t("driver.home.pendingCloseout")} />
        )}
      </ScrollView>
    </View>
  );
}
