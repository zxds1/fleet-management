import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { t } from "../../data/i18n";

export function SettingsScreen({ navigation }: { navigation: any }) {
  const lang = useStore(repository.language);
  return (
    <Screen>
      <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />
      <SectionCard>
        <TouchableOpacity onPress={() => repository.setLanguage(lang === "en" ? "sw" : "en")}>
          <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>Language: {lang === "en" ? "English" : "Swahili"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("outbox")} style={{ marginTop: 12 }}>
          <Text style={[typography.bodyLarge, { color: colors.onSurface }]}>Offline outbox</Text>
        </TouchableOpacity>
      </SectionCard>
      <SectionCard title="Support">
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>FleetPulse operations console v1.0</Text>
      </SectionCard>
      <TouchableOpacity onPress={() => repository.logout()}>
        <Text style={[typography.bodyLarge, { color: colors.statusDanger, textAlign: "center" }]}>{t("logout", lang)}</Text>
      </TouchableOpacity>
    </Screen>
  );
}

