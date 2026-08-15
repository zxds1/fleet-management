import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { AppConstants } from "../../data/constants";
import { errorCopy } from "../../data/i18n";
import { AuthScaffold, AuthSegmentedToggle } from "./AuthScaffold";
import { AuthField } from "../../components/AuthField";
import { FleetButton } from "../../components/FleetButton";
import { devBypass } from "../../devbypass";

export function LoginScreen({
  onNavigateToSignup,
  onNavigateToForgot,
}: {
  onNavigateToSignup: () => void;
  onNavigateToForgot: () => void;
}) {
  const authState = useStore(repository.authState);
  const principal = useStore(repository.principal);
  const isConnected = useStore(repository.isNetworkConnected);
  const locale = principal?.locale ?? "en";

  const [tabIndex, setTabIndex] = useState(0);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const error =
    authState.kind === "error" ? errorCopy(authState.code, locale) + (authState.message ? ` (${authState.message})` : "") : null;

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && isConnected && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await repository.login(identifier.trim(), password);
    } catch (e: any) {
      repository.setAuthError(e?.errorCode ?? "NETWORK_UNAVAILABLE", e?.message ?? "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold title="Sign in" subtitle="FleetPulse" testID="login_screen">
      <AuthSegmentedToggle
        options={["Driver (phone)", "Admin (email)"]}
        selectedIndex={tabIndex}
        onSelect={setTabIndex}
        enabled={!submitting}
      />
      <AuthField
        value={identifier}
        onChangeText={setIdentifier}
        label={tabIndex === 0 ? "Phone" : "Email"}
        placeholder={tabIndex === 0 ? AppConstants.SAMPLE_PHONE_HINT : "you@company.com"}
        keyboardType={tabIndex === 0 ? "phone-pad" : "email-address"}
        testID="identifier_input"
      />
      <AuthField
        value={password}
        onChangeText={setPassword}
        label="Password"
        secureTextEntry={!showPassword}
        testID="password_input"
      />
      {!isConnected ? (
        <Text style={{ color: colors.statusWarning, fontSize: 12 }}>Offline — cannot sign in.</Text>
      ) : null}
      {error ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
      <FleetButton text="Sign in" onPress={submit} enabled={canSubmit} testID="login_submit_btn" />
      {__DEV__ ? (
        <FleetButton
          text="Dev bypass (no backend)"
          onPress={() => devBypass(tabIndex === 0 ? "DRIVER" : "ADMIN")}
          isPrimary={false}
          testID="dev_bypass_btn"
        />
      ) : null}
      <TouchableOpacity onPress={onNavigateToForgot} disabled={submitting}>
        <Text style={{ color: colors.primary, textAlign: "center" }}>Forgot password?</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onNavigateToSignup} disabled={submitting} style={{ marginTop: spacing.sm }}>
        <Text style={{ color: colors.primary, textAlign: "center" }}>Create a company</Text>
      </TouchableOpacity>
    </AuthScaffold>
  );
}

