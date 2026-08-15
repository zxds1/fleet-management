import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { EmptyState } from "../../components/States";

export function PrivacyScreen({ navigation }: { navigation: any }) {
  const requests = useStore(repository.privacyRequests);
  return (
    <Screen>
      <ScreenHeader title="Privacy & Data" onBack={() => navigation.goBack()} />
      <SectionCard>
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]}>
          You can request a copy of your data or deletion. Requests are logged and fulfilled by the privacy service.
        </Text>
        <TouchableOpacity onPress={() => repository.requestDataExport()} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.primary }}>Request data export</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => repository.requestDataDeletion()} style={{ marginTop: 8 }}>
          <Text style={{ color: colors.statusDanger }}>Request account deletion</Text>
        </TouchableOpacity>
      </SectionCard>
      {requests.length === 0 ? (
        <EmptyState title="No requests" message="Your privacy requests will be listed here." />
      ) : (
        requests.map((r) => (
          <SectionCard key={r.id} title={`${r.requestType} · ${r.status}`}>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{String(r.createdAt)}</Text>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

