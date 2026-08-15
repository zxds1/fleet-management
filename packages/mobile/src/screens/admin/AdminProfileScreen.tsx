import React from "react";
import { View, Text, TouchableOpacity, Linking, Alert } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { Icon } from "../../components/Icon";
import { config } from "../../config";
import { MaterialIcons } from "@expo/vector-icons";

export function AdminProfileScreen({ navigation }: { navigation: any }) {
  const principal = useStore(repository.principal);
  const lang = useStore(repository.language);

  return (
    <Screen>
      <ScreenHeader title="Admin Profile" onBack={() => navigation.goBack()} />

      <SectionCard>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{principal?.displayName ?? principal?.email ?? "—"}</Text>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{principal?.email ?? principal?.phone ?? ""}</Text>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Role: {principal?.roleName ?? "—"}</Text>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Tenant: {principal?.tenantId ?? "—"}</Text>
      </SectionCard>

      <SectionCard>
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]}>Language</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TouchableOpacity
            onPress={() => repository.setLanguage("en")}
            style={{
              padding: 10,
              borderRadius: 0,
              backgroundColor: lang === "en" ? colors.primary : colors.surface,
              borderWidth: 1,
              borderColor: colors.outlineVariant,
            }}
          >
            <Text style={{ color: lang === "en" ? colors.onPrimary : colors.onSurface }}>English</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => repository.setLanguage("sw")}
            style={{
              padding: 10,
              borderRadius: 0,
              backgroundColor: lang === "sw" ? colors.primary : colors.surface,
              borderWidth: 1,
              borderColor: colors.outlineVariant,
            }}
          >
            <Text style={{ color: lang === "sw" ? colors.onPrimary : colors.onSurface }}>Swahili</Text>
          </TouchableOpacity>
        </View>
      </SectionCard>

      <Text style={[typography.titleMedium, { color: colors.onSurface, marginTop: spacing.md }]}>Admin Tools</Text>

      <AdminActionTile label="Driver Roster" icon="groups-2" onPress={() => navigation.navigate("driver_roster")} />
      <AdminActionTile label="Hardware Tracker" icon="devices" onPress={() => navigation.navigate("hardware_tracker")} />
      <AdminActionTile label="Vehicle Master" icon="directions-car" onPress={() => navigation.navigate("vehicle_master")} />
      <AdminActionTile label="DVIR Review" icon="assignment" onPress={() => navigation.navigate("dvir_review")} />
      <AdminActionTile label="Fuel Reconciliation" icon="local-gas-station" onPress={() => navigation.navigate("fuel_reconcile")} />
      <AdminActionTile label="Import Statements" icon="description" onPress={() => navigation.navigate("import_statement")} />
      <AdminActionTile label="Maintenance" icon="build" onPress={() => navigation.navigate("maintenance")} />
      <AdminActionTile label="Privacy" icon="shield" onPress={() => navigation.navigate("privacy")} />
      <AdminActionTile label="Settings" icon="settings" onPress={() => navigation.navigate("settings")} />
      <AdminActionTile
        label="Release Notes"
        icon="info"
        onPress={() => {
          const url = config.releaseNotesUrl;
          if (url) Linking.openURL(url);
          else Alert.alert("Not configured", "Release notes URL is not set.");
        }}
      />

      <FleetButton text="Log out" onPress={() => repository.logout()} isPrimary={false} style={{ marginTop: spacing.md }} />
    </Screen>
  );
}

function AdminActionTile({ label, icon, onPress }: { label: string; icon: keyof typeof MaterialIcons.glyphMap; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderColor: colors.outlineVariant,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Icon name={icon} size={20} color={colors.onSurfaceVariant} />
      <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>{label}</Text>
    </TouchableOpacity>
  );
}
