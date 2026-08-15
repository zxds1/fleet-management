import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { AuthScaffold } from "./AuthScaffold";
import { AuthField } from "../../components/AuthField";
import { FleetButton } from "../../components/FleetButton";

export function ForgotPasswordScreen({
  onResetRequested,
  onBackToLogin,
}: {
  onResetRequested: (resetId: string, hint: string) => void;
  onBackToLogin: () => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { resetId, hint } = await repository.requestPasswordReset(identifier.trim());
      onResetRequested(resetId, hint);
    } catch (e: any) {
      setError(e?.message ?? "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold title="Reset password" subtitle="FleetPulse">
      <AuthField
        value={identifier}
        onChangeText={setIdentifier}
        label="Email or phone"
        placeholder="you@company.com or +2547…"
      />
      {error ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
      <FleetButton text="Request reset" onPress={submit} enabled={identifier.trim().length > 0 && !submitting} />
      <TouchableOpacity onPress={onBackToLogin} style={{ marginTop: spacing.sm }}>
        <Text style={{ color: colors.primary, textAlign: "center" }}>Back to sign in</Text>
      </TouchableOpacity>
    </AuthScaffold>
  );
}

