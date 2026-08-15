import React from "react";
import { View, Text } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { Screen } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";

export function SuspendedScreen({ navigation }: { navigation: any }) {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <SectionCard>
          <Text style={[typography.titleLarge, { color: colors.statusDanger }]}>Account suspended</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 12 }]}>
            Your access has been revoked by an administrator. Contact your fleet manager to restore access.
          </Text>
          <FleetButton text="Sign out" onPress={() => repository.logout()} style={{ marginTop: 20 }} />
        </SectionCard>
      </View>
    </Screen>
  );
}

