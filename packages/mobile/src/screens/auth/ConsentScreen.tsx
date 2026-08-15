import React, { useState } from "react";
import { View, Text } from "react-native";
import { colors } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { AuthScaffold } from "./AuthScaffold";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { Icon } from "../../components/Icon";

/** Renders when repository.authState.kind === "needs_consent" (mirrors ConsentScreen, C5.5). */
export function ConsentScreen() {
  const authState = useStore(repository.authState);
  const [submitting, setSubmitting] = useState(false);
  const requiredVersion = authState.kind === "needs_consent" ? authState.requiredVersion : "2026.1";

  const accept = async () => {
    setSubmitting(true);
    try {
      await repository.acceptConsent();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold title="Consent required" subtitle={`Policy v${requiredVersion}`}>
      <SectionCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name="description" size={28} color={colors.primary} />
          <Text style={{ color: colors.onSurfaceVariant, fontSize: 14, flex: 1 }}>
            Before you can start a shift you must accept the current data-processing and safety consent
            policy (version {requiredVersion}). Your acceptance is recorded and can be withdrawn later.
          </Text>
        </View>
        <FleetButton text="Accept & continue" onPress={accept} enabled={!submitting} style={{ marginTop: 20 }} />
      </SectionCard>
    </AuthScaffold>
  );
}


