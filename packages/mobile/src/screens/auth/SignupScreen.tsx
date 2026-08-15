import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { errorCopy } from "../../data/i18n";
import { AuthScaffold } from "./AuthScaffold";
import { AuthField } from "../../components/AuthField";
import { FleetButton } from "../../components/FleetButton";

export function SignupScreen({ onNavigateToLogin }: { onNavigateToLogin: () => void }) {
  const authState = useStore(repository.authState);
  const principal = useStore(repository.principal);
  const locale = principal?.locale ?? "en";
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const error = authState.kind === "error" ? errorCopy(authState.code, locale) : null;

  const submit = async () => {
    setSubmitting(true);
    try {
      await repository.signupAdmin(email.trim(), password, company.trim(), fullName.trim() || undefined);
    } catch (e: any) {
      repository.setAuthError(e?.errorCode ?? "NETWORK_UNAVAILABLE", e?.message ?? "Signup failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold title="Create company" subtitle="FleetPulse">
      <AuthField value={fullName} onChangeText={setFullName} label="Full name" placeholder="Jane Manager" />
      <AuthField value={company} onChangeText={setCompany} label="Company name" placeholder="Acme Logistics" />
      <AuthField value={email} onChangeText={setEmail} label="Email" placeholder="admin@company.com" keyboardType="email-address" />
      <AuthField value={password} onChangeText={setPassword} label="Password" secureTextEntry placeholder="Min 8 characters" />
      {error ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
      <FleetButton text="Create account" onPress={submit} enabled={email.trim().length > 0 && password.length >= 8 && !submitting} />
      <TouchableOpacity onPress={onNavigateToLogin} style={{ marginTop: spacing.sm }}>
        <Text style={{ color: colors.primary, textAlign: "center" }}>Back to sign in</Text>
      </TouchableOpacity>
    </AuthScaffold>
  );
}

