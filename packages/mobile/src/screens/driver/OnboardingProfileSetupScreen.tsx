// packages/mobile/src/screens/driver/OnboardingProfileSetupScreen.tsx
//
// Onboarding step 1 (spec `driver_onboarding_profile_setup`). Collects the basic driver profile —
// name, licence, emergency contact and residential address — and POSTs it to
// `/drivers/me/onboarding/profile`. Pre-fills from `GET /drivers/me/onboarding` so a driver who
// re-enters the flow (or resumes on a new device) sees whatever the server already holds.
//
// Licence class is a fixed vocabulary, so it uses a `BottomSheet` picker rather than a free-text
// field. All copy comes from i18n (D-10).

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { ScrollView, View } from "react-native"
import { Text } from "@/design/components/Text"
import { Input } from "@/design/components/Input"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { ListRow } from "@/design/components/ListRow"
import { BottomSheet } from "@/design/components/BottomSheet"
import { Icon } from "@/design/components/Icon"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { OnboardingState } from "@/core/driver/onboarding"
import { OnboardingProgress } from "./OnboardingProgress"

/** Licence classes offered by the picker. Values are sent verbatim to the gateway. */
const LICENCE_CLASSES = ["A", "B", "C", "CE", "D", "EC"] as const

export interface OnboardingProfileSetupScreenProps {
  services: Services
  onNext: () => void
}

interface FormState {
  fullName: string
  licenceNumber: string
  licenceClass: string
  emergencyContactName: string
  emergencyContactPhone: string
  street: string
  city: string
  state: string
  zip: string
}

const EMPTY_FORM: FormState = {
  fullName: "",
  licenceNumber: "",
  licenceClass: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  street: "",
  city: "",
  state: "",
  zip: "",
}

function hydrate(state: OnboardingState): FormState {
  const address = state.address_json ?? {}
  return {
    fullName: state.full_name ?? "",
    licenceNumber: state.licence_number ?? "",
    licenceClass: state.licence_class ?? "",
    emergencyContactName: state.emergency_contact_name ?? "",
    emergencyContactPhone: state.emergency_contact_phone ?? "",
    street: address.street ?? "",
    city: address.city ?? "",
    state: address.state ?? "",
    zip: address.zip ?? "",
  }
}

/** Fields the gateway requires; anything blank blocks the submit and shows the inline message. */
const REQUIRED: readonly (keyof FormState)[] = [
  "fullName",
  "licenceNumber",
  "licenceClass",
  "emergencyContactName",
  "emergencyContactPhone",
]

export function OnboardingProfileSetupScreen({ services, onNext }: OnboardingProfileSetupScreenProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<AppError | undefined>()
  const [touched, setTouched] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setForm(hydrate(await services.onboarding.getState()))
      setError(undefined)
    } catch (e) {
      // A missing record is normal on the very first run: keep the blank form and surface the
      // error only as a dismissible banner rather than blocking data entry.
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const missing = useMemo(() => REQUIRED.filter((k) => form[k].trim().length === 0), [form])
  const errorFor = (key: keyof FormState): string | null =>
    touched && missing.includes(key) ? t("driver.onboarding.profile.required") : null

  const submit = async () => {
    setTouched(true)
    if (missing.length > 0) return
    setSaving(true)
    setError(undefined)
    try {
      await services.onboarding.saveProfile({
        full_name: form.fullName.trim(),
        licence_number: form.licenceNumber.trim(),
        licence_class: form.licenceClass.trim(),
        emergency_contact_name: form.emergencyContactName.trim(),
        emergency_contact_phone: form.emergencyContactPhone.trim(),
        address_json: {
          street: form.street.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          zip: form.zip.trim(),
        },
      })
      onNext()
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, padding: theme.spacing[5], gap: theme.spacing[4] }} testID="onboarding-profile-loading">
        <Skeleton width="60%" height={28} />
        <Skeleton height={72} />
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="onboarding-profile-screen">
      <OnboardingProgress step={1} />

      <Text preset="heading03" style={{ marginTop: theme.spacing[4] }}>
        {t("driver.onboarding.profile.title")}
      </Text>
      <Text
        preset="body02"
        color={theme.colors.onSurfaceVariant}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[5] }}
      >
        {t("driver.onboarding.profile.subtitle")}
      </Text>

      {error ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <ErrorState error={error} onAction={() => void load()} testID="onboarding-profile-error" />
        </View>
      ) : null}

      <Card variant="container" title={t("driver.onboarding.profile.basicInformation")}>
        <Input
          label={t("driver.onboarding.profile.fullName")}
          placeholder={t("driver.onboarding.profile.fullNamePlaceholder")}
          value={form.fullName}
          onChangeText={(v) => set("fullName", v)}
          error={errorFor("fullName")}
          required
          autoCapitalize="words"
          testID="onboarding-full-name"
        />
        <Input
          label={t("driver.onboarding.profile.licenceNumber")}
          placeholder={t("driver.onboarding.profile.licenceNumberPlaceholder")}
          value={form.licenceNumber}
          onChangeText={(v) => set("licenceNumber", v)}
          error={errorFor("licenceNumber")}
          required
          autoCapitalize="characters"
          testID="onboarding-licence-number"
        />
        <Text variant="label" style={{ marginBottom: theme.spacing[3] }}>
          {`${t("driver.onboarding.profile.licenceClass")} *`}
        </Text>
        <ListRow
          title={form.licenceClass || t("driver.onboarding.profile.selectLicenceClass")}
          onPress={() => setPickerOpen(true)}
          trailing={<Icon name="expand_more" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          testID="onboarding-licence-class"
        />
        {errorFor("licenceClass") ? (
          <Text variant="caption" color={theme.colors.error} style={{ marginTop: theme.spacing[2] }}>
            {t("driver.onboarding.profile.required")}
          </Text>
        ) : null}
      </Card>

      <Card variant="container" title={t("driver.onboarding.profile.emergencyContact")}>
        <Input
          label={t("driver.onboarding.profile.emergencyContactName")}
          value={form.emergencyContactName}
          onChangeText={(v) => set("emergencyContactName", v)}
          error={errorFor("emergencyContactName")}
          required
          autoCapitalize="words"
          testID="onboarding-emergency-name"
        />
        <Input
          label={t("driver.onboarding.profile.emergencyContactPhone")}
          placeholder={t("driver.onboarding.profile.emergencyContactPhonePlaceholder")}
          value={form.emergencyContactPhone}
          onChangeText={(v) => set("emergencyContactPhone", v)}
          error={errorFor("emergencyContactPhone")}
          required
          keyboardType="phone-pad"
          testID="onboarding-emergency-phone"
        />
      </Card>

      <Card variant="container" title={t("driver.onboarding.profile.address")}>
        <Input
          label={t("driver.onboarding.profile.street")}
          value={form.street}
          onChangeText={(v) => set("street", v)}
          testID="onboarding-street"
        />
        <Input
          label={t("driver.onboarding.profile.city")}
          value={form.city}
          onChangeText={(v) => set("city", v)}
          testID="onboarding-city"
        />
        <Input
          label={t("driver.onboarding.profile.state")}
          value={form.state}
          onChangeText={(v) => set("state", v)}
          testID="onboarding-state"
        />
        <Input
          label={t("driver.onboarding.profile.zip")}
          value={form.zip}
          onChangeText={(v) => set("zip", v)}
          keyboardType="number-pad"
          testID="onboarding-zip"
        />
      </Card>

      <Button
        loading={saving}
        onPress={() => void submit()}
        icon={<Icon name="arrow_forward" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
        label={t("driver.onboarding.continue")}
        testID="onboarding-profile-submit"
      />

      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("driver.onboarding.profile.selectLicenceClass")}
      >
        {LICENCE_CLASSES.map((c) => (
          <ListRow
            key={c}
            title={c}
            onPress={() => {
              set("licenceClass", c)
              setPickerOpen(false)
            }}
            trailing={
              form.licenceClass === c ? (
                <Icon name="check" size={theme.sizing.iconMd} color={theme.colors.primary} />
              ) : undefined
            }
            testID={`onboarding-licence-class-${c}`}
          />
        ))}
      </BottomSheet>
    </ScrollView>
  )
}
