// packages/mobile/src/screens/auth/SignupScreen.tsx
//
// Admin signup + company creation. One form provisions the company (tenant) and its first
// administrator via `POST /auth/signup`; `App.tsx` then reuses the *post-login* navigation
// (`AuthFlow.submitSignup` continues straight into the login leg, so MFA/consent gating and the
// role-based router choice are identical to signing in normally).
//
// Client-side validation mirrors the server policy so an obviously-invalid form never costs a
// round-trip: company name required, valid email, password ≥ 12 characters. The server stays the
// authority — its rejection is rendered through `ErrorState` below the fields.

import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import { Text } from "@/design/components/Text";
import { Input } from "@/design/components/Input";
import { Button } from "@/design/components/Button";
import { Logo } from "@/design/components/Logo";
import { ErrorState } from "@/design/components/ErrorState";
import { theme } from "@/design/theme";
import { t } from "@/core/i18n";
import { PASSWORD_MIN_LENGTH } from "@/core/auth/schemas";
import type { AppError } from "@/core/error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupSubmitInput {
  companyName: string;
  email: string;
  password: string;
  fullName?: string;
  phone?: string;
}

export interface SignupScreenProps {
  submitting: boolean;
  error?: AppError;
  onSubmit: (input: SignupSubmitInput) => void;
  onBack: () => void;
}

export function SignupScreen({ submitting, error, onSubmit, onBack }: SignupScreenProps) {
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  // Field errors only appear after a submit attempt, so the form is not hostile while typing.
  const [touched, setTouched] = useState(false);

  const companyError = !companyName.trim() ? t("auth.signup.companyNameRequired") : null;
  const emailError = !EMAIL_RE.test(email.trim()) ? t("auth.signup.emailInvalid") : null;
  const passwordError =
    password.length < PASSWORD_MIN_LENGTH ? t("auth.signup.passwordTooShort") : null;
  const valid = !companyError && !emailError && !passwordError;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onSubmit({
      companyName: companyName.trim(),
      email: email.trim(),
      password,
      fullName: fullName.trim() || undefined,
      phone: phone.trim() || undefined,
    });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.ui01 }}
      contentContainerStyle={{ padding: theme.spacing[5], flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      testID="signup-screen"
    >
      <Logo size={48} style={{ marginBottom: theme.spacing[5] }} />
      <Text preset="heading03" style={{ marginBottom: theme.spacing[2] }}>
        {t("auth.signup.title")}
      </Text>
      <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing[5] }}>
        {t("auth.signup.subtitle")}
      </Text>

      <Input
        label={t("auth.signup.companyName")}
        value={companyName}
        onChangeText={setCompanyName}
        autoCapitalize="words"
        required
        error={touched ? companyError : null}
        placeholder={t("auth.signup.companyNamePlaceholder")}
        testID="signup-company-name"
      />
      <Input
        label={t("auth.signup.fullName")}
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        placeholder={t("auth.fullNamePlaceholder")}
        testID="signup-fullname"
      />
      <Input
        label={t("auth.signup.email")}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        required
        error={touched ? emailError : null}
        placeholder={t("auth.emailPlaceholder")}
        testID="signup-email"
      />
      <Input
        label={t("auth.phone")}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder={t("auth.phonePlaceholder")}
        testID="signup-phone"
      />
      <Input
        label={t("auth.signup.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!show}
        required
        error={touched ? passwordError : null}
        helperText={t("auth.passwordHint")}
        placeholder="••••••••••••"
        trailing={
          <Button variant="ghost" fullWidth={false} onPress={() => setShow((s) => !s)} testID="signup-password-reveal">
            {show ? t("auth.hidePassword") : t("auth.showPassword")}
          </Button>
        }
        testID="signup-password"
      />

      {error && <ErrorState error={error} testID="signup-error" />}

      <View style={{ marginTop: theme.spacing[3] }}>
        <Button loading={submitting} disabled={touched && !valid} onPress={submit} testID="signup-submit">
          {t("auth.signup.createCompany")}
        </Button>
      </View>
      <View style={{ marginTop: theme.spacing[3] }}>
        <Button variant="ghost" onPress={onBack} testID="signup-back">
          {t("auth.backToLogin")}
        </Button>
      </View>
    </ScrollView>
  );
}
