// packages/mobile/src/screens/auth/MfaScreen.tsx
//
// Driver MFA challenge (docs/apps/screens/.../driver_mfa_challenge/code.html).
// The spec renders the 6-digit code as six discrete 48x48 squared cells (`.mfa-input`):
// grey field fill, 1px outline, a 2px primary bottom border while focused, no radius. The
// recovery-code path reuses the design `Input` (free text) so both modes stay on the system.

import React, { useCallback, useMemo, useRef, useState } from "react";
import { NativeSyntheticEvent, ScrollView, TextInput, TextInputKeyPressEventData, View } from "react-native";
import { Text } from "@/design/components/Text";
import { Input } from "@/design/components/Input";
import { Button } from "@/design/components/Button";
import { Icon } from "@/design/components/Icon";
import { ErrorState } from "@/design/components/ErrorState";
import { theme } from "@/design/theme";
import { t } from "@/core/i18n";
import type { AppError } from "@/core/error";

const CODE_LENGTH = 6;
const EMPTY: string[] = ["", "", "", "", "", ""];

export interface MfaScreenProps {
  submitting: boolean;
  error?: AppError;
  onSubmit: (code: string) => void;
  onUseRecovery?: () => void;
  onResend?: () => void;
  onCancel?: () => void;
}

export function MfaScreen({ submitting, error, onSubmit, onUseRecovery, onResend, onCancel }: MfaScreenProps) {
  const [digits, setDigits] = useState<string[]>(EMPTY);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [resent, setResent] = useState(false);
  const inputs = useRef<Array<TextInput | null>>([]);

  const code = useMemo(() => digits.join(""), [digits]);
  const canSubmit = recoveryMode ? recoveryCode.trim().length > 0 : code.length === CODE_LENGTH;

  const focusCell = useCallback((index: number) => {
    inputs.current[index]?.focus();
  }, []);

  /** Accepts a single typed digit or a pasted run of digits starting at `index`. */
  const handleChange = useCallback(
    (index: number, raw: string) => {
      const typed = raw.replace(/[^0-9]/g, "");
      setDigits((prev) => {
        const next = [...prev];
        if (typed.length === 0) {
          next[index] = "";
          return next;
        }
        for (let i = 0; i < typed.length && index + i < CODE_LENGTH; i += 1) {
          next[index + i] = typed[i]!;
        }
        return next;
      });
      if (typed.length > 0) {
        const target = Math.min(index + typed.length, CODE_LENGTH - 1);
        if (target !== index) focusCell(target);
      }
    },
    [focusCell],
  );

  /** Backspace on an empty cell steps back to the previous cell and clears it. */
  const handleKeyPress = useCallback(
    (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key !== "Backspace") return;
      setDigits((prev) => {
        if (prev[index]) {
          const next = [...prev];
          next[index] = "";
          return next;
        }
        if (index === 0) return prev;
        const next = [...prev];
        next[index - 1] = "";
        return next;
      });
      if (!digits[index] && index > 0) focusCell(index - 1);
    },
    [digits, focusCell],
  );

  const submit = useCallback(() => {
    onSubmit(recoveryMode ? recoveryCode.trim() : code);
  }, [code, onSubmit, recoveryCode, recoveryMode]);

  const toggleRecovery = useCallback(() => {
    setRecoveryMode((prev) => !prev);
    setResent(false);
    onUseRecovery?.();
  }, [onUseRecovery]);

  const resend = useCallback(() => {
    setDigits(EMPTY);
    setResent(true);
    focusCell(0);
    onResend?.();
  }, [focusCell, onResend]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.ui01 }}
      contentContainerStyle={{ padding: theme.spacing[5], flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      testID="mfa-screen"
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], marginBottom: theme.spacing[3] }}>
        <Icon name="lock" size={theme.sizing.iconLg} color={theme.colors.primary} />
        <Text preset="heading03">{t("mfa.title")}</Text>
      </View>
      <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing[5] }}>
        {recoveryMode ? t("mfa.recoveryHint") : t("mfa.subtitle")}
      </Text>

      {recoveryMode ? (
        <Input
          label={t("mfa.recoveryLabel")}
          placeholder={t("mfa.recoveryPlaceholder")}
          value={recoveryCode}
          onChangeText={setRecoveryCode}
          autoCapitalize="none"
          autoCorrect={false}
          testID="mfa-recovery-code"
        />
      ) : (
        <View accessibilityLabel={t("mfa.codeLabel")}>
          <Text variant="label" style={{ marginBottom: theme.spacing[3] }}>
            {t("mfa.codeLabel")}
          </Text>
          <View style={{ flexDirection: "row", gap: theme.spacing[3] }} testID="mfa-code">
            {digits.map((digit, index) => (
              <TextInput
                // Fixed-length list of cells; index is the stable identity here.
                key={`mfa-cell-${index}`}
                ref={(el) => {
                  inputs.current[index] = el;
                }}
                testID={`mfa-cell-${index}`}
                accessibilityLabel={t("mfa.digit", { index: index + 1 })}
                value={digit}
                onChangeText={(value) => handleChange(index, value)}
                onKeyPress={(e) => handleKeyPress(index, e)}
                onFocus={() => setFocusedIndex(index)}
                onBlur={() => setFocusedIndex((prev) => (prev === index ? null : prev))}
                keyboardType="number-pad"
                inputMode="numeric"
                returnKeyType="done"
                maxLength={CODE_LENGTH}
                selectTextOnFocus
                maxFontSizeMultiplier={theme.a11y.maxFontSizeMultiplier}
                style={{
                  flex: 1,
                  height: theme.sizing.inputHeight,
                  textAlign: "center",
                  fontSize: theme.typography.metric.fontSize,
                  fontWeight: theme.typography.metric.fontWeight,
                  fontFamily: theme.typography.fontFamily.semibold,
                  color: theme.colors.onSurface,
                  backgroundColor: focusedIndex === index ? theme.colors.surface : theme.colors.surfaceContainer,
                  borderRadius: theme.radius.none,
                  borderWidth: 1,
                  borderColor: error ? theme.colors.error : theme.colors.outline,
                  borderBottomWidth: 2,
                  borderBottomColor: error
                    ? theme.colors.error
                    : focusedIndex === index
                      ? theme.colors.primary
                      : theme.colors.outline,
                }}
              />
            ))}
          </View>
        </View>
      )}

      {resent && !recoveryMode ? (
        <Text variant="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[3] }}>
          {t("mfa.resent")}
        </Text>
      ) : null}

      {error && (
        <View style={{ marginTop: theme.spacing[4] }}>
          <ErrorState error={error} />
        </View>
      )}

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button loading={submitting} disabled={!canSubmit} onPress={submit} testID="mfa-submit">
          {t("mfa.verify")}
        </Button>
      </View>

      {!recoveryMode && (
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button variant="secondary" disabled={submitting} onPress={resend} testID="mfa-resend">
            {t("mfa.resend")}
          </Button>
        </View>
      )}

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button variant="ghost" onPress={toggleRecovery} testID="mfa-use-recovery">
          {recoveryMode ? t("mfa.useCode") : t("mfa.useRecovery")}
        </Button>
      </View>

      <View style={{ marginTop: theme.spacing[2] }}>
        <Button variant="ghost" onPress={() => onCancel?.()} testID="mfa-cancel">
          {t("mfa.cancel")}
        </Button>
      </View>
    </ScrollView>
  );
}
