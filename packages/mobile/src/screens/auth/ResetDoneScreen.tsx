import React from "react";
import { View, Text } from "react-native";
import { colors } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { AuthScaffold } from "./AuthScaffold";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { Icon } from "../../components/Icon";

export function ResetDoneScreen({ onBackToLogin }: { onBackToLogin: () => void }) {
  const principal = useStore(repository.principal);
  const locale = principal?.locale ?? "en";
  return (
    <AuthScaffold title="Password reset" subtitle="">
      <SectionCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name="check-circle" size={28} color={colors.statusSafe} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurfaceVariant, fontSize: 14 }}>
              Your password has been reset. All other sessions were revoked — sign in again to continue.
            </Text>
          </View>
        </View>
        <FleetButton text="Sign in" onPress={onBackToLogin} style={{ marginTop: 20 }} />
      </SectionCard>
    </AuthScaffold>
  );
}


