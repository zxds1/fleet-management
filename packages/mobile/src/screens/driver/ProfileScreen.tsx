import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { t } from "../../data/i18n";

export function ProfileScreen({ navigation }: { navigation: any }) {
  const principal = useStore(repository.principal);
  const lang = useStore(repository.language);

  return (
    <Screen>
      <ScreenHeader title="Profile" onBack={() => navigation.goBack()} />
      <SectionCard>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{principal?.displayName ?? "—"}</Text>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{principal?.email ?? principal?.phone ?? ""}</Text>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Role: {principal?.roleName ?? "—"}</Text>
      </SectionCard>

      <SectionCard>
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]}>Language</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TouchableOpacity onPress={() => repository.setLanguage("en")} style={{ padding: 10, borderRadius: 0, backgroundColor: lang === "en" ? colors.primary : colors.surface, borderWidth: 1, borderColor: colors.outlineVariant }}>
            <Text style={{ color: lang === "en" ? colors.onPrimary : colors.onSurface }}>English</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => repository.setLanguage("sw")} style={{ padding: 10, borderRadius: 0, backgroundColor: lang === "sw" ? colors.primary : colors.surface, borderWidth: 1, borderColor: colors.outlineVariant }}>
            <Text style={{ color: lang === "sw" ? colors.onPrimary : colors.onSurface }}>Swahili</Text>
          </TouchableOpacity>
        </View>
      </SectionCard>

      <SectionCard>
        <TouchableOpacity onPress={() => navigation.navigate("onboarding")}>
          <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>Replay onboarding</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("outbox")}>
          <Text style={[typography.bodyLarge, { color: colors.onSurface, marginTop: 12 }]}>Outbox (offline queue)</Text>
        </TouchableOpacity>
      </SectionCard>

      <FleetButton text={t("logout", lang)} onPress={() => repository.logout()} isPrimary={false} />
    </Screen>
  );
}

