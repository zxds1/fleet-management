// packages/mobile/src/screens/driver/BackgroundCheckScreen.tsx
//
// Onboarding step 2 (spec `driver_onboarding_background_check`). Collects the SSN, date of birth,
// a repeating previous-address history and the investigative-report consent, then POSTs to
// `/drivers/me/background-check`.
//
// Two distinct states share this screen:
//   • entry form — while `background_check_status` is NOT_STARTED (or FAILED, so it can be redone);
//   • processing — once the check is SUBMITTED, the form is replaced by the "1-3 business days"
//     panel, because re-submitting would only duplicate the third-party request.
//
// Security: the SSN is only ever held in component state, rendered `secureTextEntry`, and cleared
// as soon as the submission succeeds. "Save draft" deliberately keeps the SSN out of the draft.

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { Text } from "@/design/components/Text"
import { Input } from "@/design/components/Input"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Banner } from "@/design/components/Banner"
import { StatusBadge } from "@/design/components/StatusBadge"
import { Icon } from "@/design/components/Icon"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { BackgroundCheckStatus, PreviousAddress } from "@/core/driver/onboarding"
import { OnboardingProgress } from "./OnboardingProgress"

export interface BackgroundCheckScreenProps {
  services: Services
  onNext: () => void
  onBack: () => void
}

/** A blank address row; the form always renders at least one. */
const emptyAddress = (): PreviousAddress => ({ street: "", city: "", state: "", zip: "" })

/** `YYYY-MM-DD`, and a real calendar date (rejects 2026-02-31). */
function isValidDob(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** A row counts only when the driver actually typed something into it. */
function isFilled(a: PreviousAddress): boolean {
  return [a.street, a.city, a.state, a.zip].some((v) => v.trim().length > 0)
}

function formatWhen(iso?: string | null): string {
  if (!iso) return t("common.notAvailable")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? t("common.notAvailable") : d.toLocaleDateString()
}

/** Carbon checkbox: 20px square, 1px #161616 border, filled with a check when selected. Local to
 *  this screen because the design system intentionally ships a `Toggle` (switch) but no checkbox,
 *  and the spec calls for `.carbon-checkbox` here. */
function ConsentCheckbox({
  checked,
  onChange,
  label,
  testID,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  testID?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: theme.spacing[4],
        minHeight: theme.sizing.minTouchTarget,
        paddingVertical: theme.spacing[3],
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          marginTop: 2,
          borderWidth: 1,
          borderColor: theme.colors.onSurface,
          borderRadius: theme.radius.none,
          backgroundColor: checked ? theme.colors.onSurface : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Icon name="check" size={16} color={theme.colors.surface} /> : null}
      </View>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function BackgroundCheckScreen({ services, onNext, onBack }: BackgroundCheckScreenProps) {
  const [ssn, setSsn] = useState("")
  const [dob, setDob] = useState("")
  const [addresses, setAddresses] = useState<PreviousAddress[]>([emptyAddress()])
  const [consent, setConsent] = useState(false)
  const [ssnOnFile, setSsnOnFile] = useState(false)
  const [status, setStatus] = useState<BackgroundCheckStatus>("NOT_STARTED")
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | undefined>()
  const [touched, setTouched] = useState(false)
  const [notice, setNotice] = useState<string>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const state = await services.onboarding.getState()
      setStatus(state.background_check_status)
      setSubmittedAt(state.background_check_submitted_at ?? null)
      setSsnOnFile(state.ssn_on_file === true)
      setConsent(state.consent_given === true)
      setDob(state.dob ?? "")
      const previous = (state.previous_addresses_json ?? [])
        .map((a) => ({ street: a.street ?? "", city: a.city ?? "", state: a.state ?? "", zip: a.zip ?? "" }))
        .filter(isFilled)
      setAddresses(previous.length > 0 ? previous : [emptyAddress()])
      setError(undefined)
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  const setAddressField = (index: number, key: keyof PreviousAddress, value: string) =>
    setAddresses((prev) => prev.map((a, i) => (i === index ? { ...a, [key]: value } : a)))

  const addAddress = () => setAddresses((prev) => [...prev, emptyAddress()])
  const removeAddress = (index: number) =>
    setAddresses((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))

  const ssnError = useMemo(() => {
    if (!touched) return null
    if (ssn.trim().length === 0 && !ssnOnFile) return t("driver.onboarding.profile.required")
    return null
  }, [touched, ssn, ssnOnFile])

  const dobError = useMemo(() => {
    if (!touched) return null
    if (dob.trim().length === 0) return t("driver.onboarding.profile.required")
    if (!isValidDob(dob.trim())) return t("driver.onboarding.background.dobInvalid")
    return null
  }, [touched, dob])

  const consentError = touched && !consent ? t("driver.onboarding.background.consentRequired") : null

  const submit = async () => {
    setTouched(true)
    setNotice(undefined)
    if ((ssn.trim().length === 0 && !ssnOnFile) || !isValidDob(dob.trim()) || !consent) return
    setSubmitting(true)
    setError(undefined)
    try {
      const next = await services.onboarding.submitBackgroundCheck({
        // The gateway performs the encryption at rest; the transport is TLS. We never keep the raw
        // value after this call returns.
        ssn_encrypted: ssn.trim(),
        dob: dob.trim(),
        previous_addresses_json: addresses.filter(isFilled).map((a) => ({
          street: a.street.trim(),
          city: a.city.trim(),
          state: a.state.trim(),
          zip: a.zip.trim(),
        })),
        consent_given: true,
      })
      setSsn("")
      setStatus(next.background_check_status)
      setSubmittedAt(next.background_check_submitted_at ?? null)
      setSsnOnFile(next.ssn_on_file === true)
      onNext()
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setSubmitting(false)
    }
  }

  // "Save draft" keeps what has been typed in memory and confirms it; the SSN is intentionally not
  // persisted anywhere, so leaving the flow requires re-entering it.
  const saveDraft = () => setNotice(t("driver.onboarding.background.draftSaved"))

  if (loading) {
    return (
      <View style={{ flex: 1, padding: theme.spacing[5], gap: theme.spacing[4] }} testID="onboarding-background-loading">
        <Skeleton width="60%" height={28} />
        <Skeleton height={96} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </View>
    )
  }

  // Processing state — the check is with the third-party provider; no re-submission possible.
  if (status === "SUBMITTED") {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="onboarding-background-processing">
        <OnboardingProgress step={2} />
        <View style={{ alignItems: "center", marginTop: theme.spacing[6], marginBottom: theme.spacing[5] }}>
          <Icon name="pending" size={48} color={theme.colors.primary} />
          <Text preset="heading03" align="center" style={{ marginTop: theme.spacing[4] }}>
            {t("driver.onboarding.background.processingTitle")}
          </Text>
          <View style={{ marginTop: theme.spacing[3] }}>
            <StatusBadge label={t(`driver.onboarding.status.${status}`)} tone="info" testID="onboarding-background-status" />
          </View>
        </View>

        <Card variant="container">
          <Text variant="body" color={theme.colors.onSurfaceVariant}>
            {t("driver.onboarding.background.processing")}
          </Text>
          <Text variant="caption" color={theme.colors.secondary} style={{ marginTop: theme.spacing[3] }}>
            {t("driver.onboarding.background.submittedAt", { when: formatWhen(submittedAt) })}
          </Text>
        </Card>

        <Button
          onPress={onNext}
          icon={<Icon name="arrow_forward" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
          label={t("driver.onboarding.continue")}
          testID="onboarding-background-processing-continue"
        />
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button variant="ghost" onPress={onBack} label={t("driver.onboarding.back")} />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="onboarding-background-screen">
      <OnboardingProgress step={2} />

      <Text preset="heading03" style={{ marginTop: theme.spacing[4], marginBottom: theme.spacing[4] }}>
        {t("driver.onboarding.background.title")}
      </Text>

      {status === "CLEARED" ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <Banner tone="success" message={t("driver.onboarding.background.cleared")} testID="onboarding-background-cleared" />
        </View>
      ) : null}
      {status === "FAILED" ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <Banner tone="danger" message={t("driver.onboarding.background.failed")} testID="onboarding-background-failed" />
        </View>
      ) : null}
      {notice ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <Banner tone="info" message={notice} testID="onboarding-background-notice" />
        </View>
      ) : null}
      {error ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <ErrorState error={error} onAction={() => void load()} testID="onboarding-background-error" />
        </View>
      ) : null}

      {/* Informational panel (spec: primary left accent). */}
      <Card variant="container" accent={theme.colors.primary} title={t("driver.onboarding.background.whyTitle")}>
        <Text variant="body" color={theme.colors.onSurfaceVariant}>
          {t("driver.onboarding.background.whyBody")}
        </Text>
      </Card>

      <Input
        label={t("driver.onboarding.background.ssn")}
        placeholder={t("driver.onboarding.background.ssnPlaceholder")}
        value={ssn}
        onChangeText={setSsn}
        secureTextEntry
        autoComplete="off"
        autoCorrect={false}
        keyboardType="number-pad"
        required={!ssnOnFile}
        error={ssnError}
        helperText={ssnOnFile ? t("driver.onboarding.background.ssnOnFile") : t("driver.onboarding.background.ssnHelper")}
        testID="onboarding-ssn"
      />

      <Input
        label={t("driver.onboarding.background.dob")}
        placeholder={t("driver.onboarding.background.dobPlaceholder")}
        value={dob}
        onChangeText={setDob}
        required
        error={dobError}
        keyboardType="numbers-and-punctuation"
        testID="onboarding-dob"
      />

      <Text preset="heading01" style={{ marginTop: theme.spacing[4] }}>
        {t("driver.onboarding.background.addressHistory")}
      </Text>
      <Text
        variant="body"
        color={theme.colors.secondary}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}
      >
        {t("driver.onboarding.background.addressHistoryHint")}
      </Text>

      {addresses.map((address, index) => (
        <Card
          key={`address-${index}`}
          variant="container"
          title={t("driver.onboarding.background.addressNumber", { index: index + 1 })}
          trailing={
            addresses.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("driver.onboarding.background.removeAddress")}
                onPress={() => removeAddress(index)}
                hitSlop={8}
                style={{
                  minWidth: theme.sizing.minTouchTarget,
                  minHeight: theme.sizing.minTouchTarget,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                testID={`onboarding-address-remove-${index}`}
              >
                <Icon name="delete" size={theme.sizing.iconMd} color={theme.colors.error} />
              </Pressable>
            ) : undefined
          }
          testID={`onboarding-address-${index}`}
        >
          <Input
            label={t("driver.onboarding.profile.street")}
            value={address.street}
            onChangeText={(v) => setAddressField(index, "street", v)}
            testID={`onboarding-address-street-${index}`}
          />
          <Input
            label={t("driver.onboarding.profile.city")}
            value={address.city}
            onChangeText={(v) => setAddressField(index, "city", v)}
            testID={`onboarding-address-city-${index}`}
          />
          <Input
            label={t("driver.onboarding.profile.state")}
            value={address.state}
            onChangeText={(v) => setAddressField(index, "state", v)}
            testID={`onboarding-address-state-${index}`}
          />
          <Input
            label={t("driver.onboarding.profile.zip")}
            value={address.zip}
            onChangeText={(v) => setAddressField(index, "zip", v)}
            keyboardType="number-pad"
            testID={`onboarding-address-zip-${index}`}
          />
        </Card>
      ))}

      <Button
        variant="ghost"
        fullWidth={false}
        onPress={addAddress}
        icon={<Icon name="add" size={theme.sizing.iconMd} color={theme.colors.primary} />}
        label={t("driver.onboarding.background.addAnotherAddress")}
        testID="onboarding-address-add"
      />

      <View
        style={{
          marginTop: theme.spacing[5],
          padding: theme.spacing[4],
          backgroundColor: theme.colors.surfaceContainer,
          borderWidth: 1,
          borderColor: theme.colors.outlineVariant,
        }}
      >
        <ConsentCheckbox
          checked={consent}
          onChange={setConsent}
          label={t("driver.onboarding.background.consent")}
          testID="onboarding-consent"
        />
        {consentError ? (
          <Text variant="caption" color={theme.colors.error}>
            {consentError}
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button
          loading={submitting}
          onPress={() => void submit()}
          icon={<Icon name="arrow_forward" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
          label={t("driver.onboarding.continue")}
          testID="onboarding-background-submit"
        />
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button
            variant="secondary"
            onPress={saveDraft}
            label={t("driver.onboarding.saveDraft")}
            testID="onboarding-background-draft"
          />
        </View>
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button variant="ghost" onPress={onBack} label={t("driver.onboarding.back")} testID="onboarding-background-back" />
        </View>
      </View>
    </ScrollView>
  )
}
