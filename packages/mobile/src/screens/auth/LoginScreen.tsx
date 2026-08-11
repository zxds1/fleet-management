// packages/mobile/src/screens/auth/LoginScreen.tsx
//
// Driver (phone) / admin (email) sign-in, following the `driver_login` + `admin_login` specs:
// role toggle, identifier + password with an inline reveal icon, a "Forgot password?" link, a
// primary submit, and a secondary biometric alternative. When the socket is not connected the
// screen surfaces the offline banner and disables submit (a login is a network write, D §D).
import React, { useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Text } from "@/design/components/Text";
import { Input } from "@/design/components/Input";
import { Button } from "@/design/components/Button";
import { Icon } from "@/design/components/Icon";
import { Logo } from "@/design/components/Logo";
import { ErrorState } from "@/design/components/ErrorState";
import { OfflineBanner } from "@/design/components/OfflineBanner";
import { theme } from "@/design/theme";
import { t, getLocale, setLocale, availableLocales, type Locale } from "@/core/i18n";
import type { AppError } from "@/core/error";
import type { Role } from "@/core/auth/flow";

export interface LoginScreenProps {
  submitting: boolean
  error?: AppError
  onSubmit: (identifier: string, password: string, role: Role) => void
  onSignup: () => void
  /** When true, the app is in demo (backend-less) mode — surface a hint to the user. */
  demo?: boolean
  /** One-tap entry into the fake backend as a given role (demo mode only). */
  onDemoEnter?: (role: Role) => void
  /** Unlock with the device biometric (a saved session is replayed by the caller). */
  onBiometric?: () => void
  /** Password-recovery entry point. */
  onForgot?: () => void
  /** Connectivity: when false the banner shows and submit is disabled (login needs the network). */
  online?: boolean
}

const ROLES: Role[] = ["driver", "admin"];

export function LoginScreen({
  submitting,
  error,
  onSubmit,
  onSignup,
  demo,
  onDemoEnter,
  onBiometric,
  onForgot,
  online = true,
}: LoginScreenProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [role, setRole] = useState<Role>("driver");
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  const isDriver = role === "driver";
  const identifierLabel = isDriver ? t("auth.phone") : t("auth.email");
  const identifierPlaceholder = isDriver ? t("auth.phonePlaceholder") : t("auth.emailPlaceholder");

  const cycleLocale = () => {
    const locales = availableLocales();
    const next = locales[(locales.indexOf(locale) + 1) % locales.length] ?? locale;
    setLocale(next);
    setLocaleState(next);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.ui01 }}
      contentContainerStyle={{ padding: theme.spacing[5], flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      testID="login-screen"
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: theme.spacing[5],
        }}
      >
        <Logo size={48} />
        <Pressable
          onPress={cycleLocale}
          accessibilityRole="button"
          accessibilityLabel={t("common.language")}
          testID="login-locale"
          style={{
            minWidth: theme.sizing.minTouchTarget,
            minHeight: theme.sizing.minTouchTarget,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: theme.spacing[1],
          }}
        >
          <Icon name="language" size={20} color={theme.colors.interactive01} />
          <Text preset="label" color={theme.colors.interactive01}>
            {locale.toUpperCase()}
          </Text>
        </Pressable>
      </View>

      <OfflineBanner online={online} />

      <Text preset="heading03" style={{ marginBottom: theme.spacing[2] }}>
        {t("auth.loginTitle")}
      </Text>
      <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing[5] }}>
        {isDriver ? t("auth.loginSubtitle") : t("auth.adminLoginSubtitle")}
      </Text>

      <View
        style={{
          flexDirection: "row",
          backgroundColor: theme.colors.surfaceContainerHigh,
          borderRadius: theme.radius.none,
          padding: theme.spacing[1],
          marginBottom: theme.spacing[5],
        }}
        testID="login-role"
      >
        {ROLES.map((r) => {
          const selected = r === role;
          return (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`login-role-${r}`}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                minHeight: theme.sizing.minTouchTarget,
                backgroundColor: selected ? theme.colors.primary : "transparent",
              }}
            >
              <Text
                variant="bodyStrong"
                color={selected ? theme.colors.onPrimary : theme.colors.textSecondary}
              >
                {t(`roleSwitch.${r}`).replace(/^Continue as /, "")}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Input
        label={identifierLabel}
        value={identifier}
        onChangeText={setIdentifier}
        keyboardType={isDriver ? "phone-pad" : "email-address"}
        autoCapitalize="none"
        placeholder={identifierPlaceholder}
        testID="login-identifier"
      />
      <Input
        label={t("auth.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!show}
        placeholder="••••••••"
        trailing={
          <Pressable
            onPress={() => setShow((s) => !s)}
            accessibilityRole="button"
            accessibilityLabel={show ? t("auth.hidePassword") : t("auth.showPassword")}
            accessibilityState={{ selected: show }}
            testID="login-password-reveal"
            style={{
              width: theme.sizing.minTouchTarget,
              height: theme.sizing.minTouchTarget,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              name={show ? "visibility_off" : "visibility"}
              size={20}
              color={theme.colors.onSurfaceVariant}
            />
          </Pressable>
        }
        testID="login-password"
      />

      <View style={{ alignItems: "flex-end" }}>
        <Button variant="ghost" fullWidth={false} onPress={() => onForgot?.()} testID="login-forgot">
          {t("login.forgotPassword")}
        </Button>
      </View>

      {error && <ErrorState error={error} />}

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button
          loading={submitting}
          disabled={!online}
          onPress={() => onSubmit(identifier, password, role)}
          testID="login-submit"
        >
          {t("auth.logIn")}
        </Button>
      </View>
      {!online && (
        <Text preset="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
          {t("login.offlineSubmitHint")}
        </Text>
      )}

      <View style={{ marginTop: theme.spacing[3] }}>
        <Button
          variant="secondary"
          onPress={() => onBiometric?.()}
          icon={<Icon name="fingerprint" size={20} color={theme.colors.primary} />}
          testID="login-biometric"
        >
          {t("login.biometrics")}
        </Button>
        <Text preset="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
          {t("login.biometricsHint")}
        </Text>
      </View>

      <View style={{ marginTop: theme.spacing[2] }}>
        <Button variant="ghost" onPress={onSignup} testID="login-signup">
          {t("auth.signup.createCompany")}
        </Button>
      </View>

      {demo && (
        <View style={{ marginTop: theme.spacing[5] }} testID="login-demo-hint">
          <Text preset="label" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[2] }}>
            {t("login.demoTitle")}
          </Text>
          <Button variant="secondary" onPress={() => onDemoEnter?.("driver")} testID="login-demo-driver">
            {t("roleSwitch.driver").replace(/^Continue as /, "")}
          </Button>
          <View style={{ marginTop: theme.spacing[3] }}>
            <Button variant="secondary" onPress={() => onDemoEnter?.("admin")} testID="login-demo-admin">
              {t("roleSwitch.admin").replace(/^Continue as /, "")}
            </Button>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
