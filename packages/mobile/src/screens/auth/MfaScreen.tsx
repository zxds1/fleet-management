import React, { useState } from "react";
import { View, Text } from "react-native";
import { colors } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { AuthScaffold } from "./AuthScaffold";
import { AuthField } from "../../components/AuthField";
import { FleetButton } from "../../components/FleetButton";
import { Icon } from "../../components/Icon";

/** Renders when repository.authState.kind === "needs_mfa" (mirrors MfaScreen). */
export function MfaScreen() {
  const authState = useStore(repository.authState);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const challengeToken = authState.kind === "needs_mfa" ? authState.challengeToken : "";

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await repository.verifyMfa(challengeToken, code.trim());
    } catch (e: any) {
      setError(e?.message ?? "Invalid code");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold title="Two-factor" subtitle="Enter the code from your authenticator">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name="shield" size={28} color={colors.primary} />
        <Text style={{ color: colors.onSurfaceVariant, fontSize: 14, flex: 1 }}>
          Multi-factor authentication is required to finish signing in.
        </Text>
      </View>
      <AuthField value={code} onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))} label="MFA code" keyboardType="number-pad" />
      {error ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
      <FleetButton text="Verify" onPress={submit} enabled={code.length >= 4 && !submitting} />
    </AuthScaffold>
  );
}


