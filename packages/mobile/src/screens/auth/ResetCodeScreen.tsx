import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { AuthScaffold } from "./AuthScaffold";
import { AuthField } from "../../components/AuthField";
import { FleetButton } from "../../components/FleetButton";

export function ResetCodeScreen({
  resetId,
  contactHint,
  onResetComplete,
  onBackToLogin,
}: {
  resetId: string;
  contactHint: string | null;
  onResetComplete: () => void;
  onBackToLogin: () => void;
}) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await repository.completePasswordReset(resetId, code.trim(), password);
      onResetComplete();
    } catch (e: any) {
      setError(e?.message ?? "Reset failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold title="Enter reset code" subtitle={contactHint ?? ""}>
      <Text style={{ color: colors.onSurfaceVariant, fontSize: 12 }}>
        A code was sent to your contact on file. Enter it with a new password.
      </Text>
      <AuthField value={code} onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 8))} label="Reset code" keyboardType="number-pad" />
      <AuthField value={password} onChangeText={setPassword} label="New password" secureTextEntry placeholder="Min 8 characters" />
      {error ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
      <FleetButton text="Set new password" onPress={submit} enabled={code.length >= 4 && password.length >= 8 && !submitting} />
      <TouchableOpacity onPress={onBackToLogin} style={{ marginTop: spacing.sm }}>
        <Text style={{ color: colors.primary, textAlign: "center" }}>Back to sign in</Text>
      </TouchableOpacity>
    </AuthScaffold>
  );
}

