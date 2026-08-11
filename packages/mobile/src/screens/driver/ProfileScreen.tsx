// packages/mobile/src/screens/driver/ProfileScreen.tsx
//
// B.16 Driver profile & settings (specs `driver_profile_details` / `refined_driver_profile_with_training`).
// Self-fetching: the identity block comes from the session `Principal` (name/email/phone/roles) and
// the licence / emergency-contact / compliance detail comes from the driver onboarding record
// (`services.onboarding.getState()`), which is the only driver-scoped read that exposes those fields.
// The assigned vehicle comes from `services.onboarding.getAssignment()`.
//
// Sections (mirroring the spec):
//   • Identity header — avatar initials, name, driver id, duty status chip, licence class chip
//   • Contact information — email, phone, emergency contact
//   • Current assignment — assigned vehicle / plate / status
//   • Compliance — background-check status and onboarding completion
//   • Quick links — Outbox, My Shifts, Documents, Training, Role switch
//   • Language + log out
//
// Everything degrades to "—" when the record is partially filled or the read fails offline, and all
// copy comes from i18n (D-10).

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { ListRow } from "@/design/components/ListRow"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { Icon, type IconName } from "@/design/components/Icon"
import { theme } from "@/design/theme"
import { t, getLocale, availableLocales, type Locale } from "@/core/i18n"
import type { Services } from "@/services"
import type { BackgroundCheckStatus, OnboardingState, VehicleAssignment } from "@/core/driver/onboarding"

export interface ProfileScreenProps {
  services: Services
  /** Identity fallback when the principal carries no e-mail (phone-only driver accounts). */
  email: string
  onOpenOutbox: () => void
  onMyShifts: () => void
  onDocuments: () => void
  /** Optional — the driver's own fuel purchase history (B.9). */
  onFuelHistory?: () => void
  /** Optional — the driver's DVIR submissions (B.10). */
  onDvirList?: () => void
  /** Optional — the driver's own accident reports (B.14). */
  onMyAccidents?: () => void
  /** Optional — the training hub link (spec `refined_driver_profile_with_training`). */
  onTraining?: () => void
  /** Optional — rendered only when the surface exposes a role switch (dual-role principals). */
  onRoleSwitch?: () => void
  onSwitchLocale: (l: Locale) => void
  onLogout: () => void
  onBack: () => void
}

/** "Asha Maina" → "AM"; falls back to the first character of whatever identifier we have. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? "?"
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""
  return `${first}${second}`.toUpperCase()
}

function backgroundTone(status: BackgroundCheckStatus): BadgeTone {
  switch (status) {
    case "CLEARED":
      return "success"
    case "FAILED":
      return "danger"
    case "SUBMITTED":
      return "info"
    default:
      return "warning"
  }
}

/** Read-only "label / value" pair used by the contact + assignment cards. */
function DetailRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], marginTop: theme.spacing[3] }}>
      <Icon name={icon} size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
      <View style={{ flex: 1 }}>
        <Text preset="caption" color={theme.colors.onSurfaceVariant}>
          {label}
        </Text>
        <Text preset="body02" style={{ marginTop: 2 }}>
          {value}
        </Text>
      </View>
    </View>
  )
}

export function ProfileScreen({
  services,
  email,
  onOpenOutbox,
  onMyShifts,
  onDocuments,
  onFuelHistory,
  onDvirList,
  onMyAccidents,
  onTraining,
  onRoleSwitch,
  onSwitchLocale,
  onLogout,
  onBack,
}: ProfileScreenProps) {
  const [state, setState] = useState<OnboardingState>()
  const [assignment, setAssignment] = useState<VehicleAssignment | null>(null)
  const [loading, setLoading] = useState(true)
  const locale = getLocale()
  const principal = services.session.principal
  const dash = t("common.notAvailable")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setState(await services.onboarding.getState())
    } catch {
      // Offline / record unavailable — the identity block still renders from the principal.
    }
    try {
      setAssignment(await services.onboarding.getAssignment())
    } catch {
      // No assignment read offline; the card shows the "not assigned" copy.
    }
    setLoading(false)
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  const displayName = state?.full_name?.trim() || principal?.email || email
  const driverId = state?.driver_id ?? principal?.userId
  const backgroundStatus: BackgroundCheckStatus = state?.background_check_status ?? "NOT_STARTED"
  const onDuty = state?.onboarding_complete === true

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="profile-screen">
      {/* Identity header */}
      <Card variant="container" testID="profile-identity">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[4] }}>
          <View
            style={{
              width: 56,
              height: 56,
              backgroundColor: theme.colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
            accessibilityElementsHidden
          >
            <Text preset="title" color={theme.colors.onPrimary}>
              {initialsOf(displayName)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text preset="heading03">{displayName}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: theme.spacing[2] }}>
              <Icon name="badge" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
              <Text preset="caption" color={theme.colors.onSurfaceVariant} testID="profile-driver-id">
                {t("driver.profile.driverId", { id: driverId ? driverId.slice(0, 12) : dash })}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], marginTop: theme.spacing[4] }}>
          <StatusBadge
            label={onDuty ? t("driver.profile.statusActive") : t("driver.profile.statusOnboarding")}
            tone={onDuty ? "success" : "warning"}
            testID="profile-duty-status"
          />
          {state?.licence_class ? (
            <StatusBadge label={t("driver.profile.licenceClassChip", { class: state.licence_class })} tone="info" />
          ) : null}
        </View>
      </Card>

      {/* Licence */}
      <Card variant="container" testID="profile-licence">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
          <Icon name="card_membership" size={theme.sizing.iconMd} color={theme.colors.primary} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("driver.profile.licence")}
          </Text>
        </View>
        <DetailRow icon="id_card" label={t("driver.profile.licenceNumber")} value={state?.licence_number ?? dash} />
        <DetailRow icon="verified_user" label={t("driver.profile.licenceClass")} value={state?.licence_class ?? dash} />
      </Card>

      {/* Contact information */}
      <Card variant="container" testID="profile-contact">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
          <Icon name="contact_support" size={theme.sizing.iconMd} color={theme.colors.primary} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("driver.profile.contactInformation")}
          </Text>
        </View>
        <DetailRow icon="mail" label={t("auth.email")} value={principal?.email || email || dash} />
        <DetailRow icon="call" label={t("auth.phone")} value={principal?.phone ?? dash} />
        <DetailRow
          icon="medical_information"
          label={t("driver.profile.emergencyContact")}
          value={
            state?.emergency_contact_name
              ? `${state.emergency_contact_name}${state.emergency_contact_phone ? ` · ${state.emergency_contact_phone}` : ""}`
              : dash
          }
        />
      </Card>

      {/* Current assignment */}
      <Card variant="container" testID="profile-assignment">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
          <Icon name="local_shipping" size={theme.sizing.iconMd} color={theme.colors.primary} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("driver.profile.currentAssignment")}
          </Text>
        </View>
        {assignment ? (
          <>
            <DetailRow
              icon="directions_car"
              label={t("driver.profile.vehicle")}
              value={assignment.vehicle_plate ?? assignment.vehicle_id}
            />
            <DetailRow
              icon="assignment"
              label={t("driver.profile.assignmentStatus")}
              value={assignment.status ?? dash}
            />
          </>
        ) : (
          <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[3] }}>
            {loading ? t("common.loading") : t("driver.profile.noAssignment")}
          </Text>
        )}
      </Card>

      {/* Compliance */}
      <Card variant="container" testID="profile-compliance">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
          <Icon name="verified_user" size={theme.sizing.iconMd} color={theme.colors.primary} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("driver.profile.compliance")}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], marginTop: theme.spacing[3] }}>
          <Icon name="school" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
          <View style={{ flex: 1 }}>
            <Text preset="caption" color={theme.colors.onSurfaceVariant}>
              {t("driver.profile.backgroundCheck")}
            </Text>
          </View>
          <StatusBadge
            label={t(`driver.onboarding.status.${backgroundStatus}`)}
            tone={backgroundTone(backgroundStatus)}
            testID="profile-background-status"
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], marginTop: theme.spacing[3] }}>
          <Icon name="fact_check" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
          <View style={{ flex: 1 }}>
            <Text preset="caption" color={theme.colors.onSurfaceVariant}>
              {t("driver.profile.onboardingStatus")}
            </Text>
          </View>
          <StatusBadge
            label={onDuty ? t("common.statusCompleted") : t("common.pending")}
            tone={onDuty ? "success" : "warning"}
          />
        </View>
      </Card>

      {/* Quick links */}
      <Card variant="container" style={{ padding: 0 }} testID="profile-links">
        <ListRow
          title={t("driver.profile.openOutbox")}
          subtitle={t("driver.profile.openOutboxHint")}
          onPress={onOpenOutbox}
          trailing={<Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          testID="profile-outbox"
        />
        <ListRow
          title={t("driver.profile.myShifts")}
          onPress={onMyShifts}
          trailing={<Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          testID="profile-shifts"
        />
        {onDvirList ? (
          <ListRow
            title={t("driver.dvir.title")}
            onPress={onDvirList}
            trailing={<Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />}
            testID="profile-dvir"
          />
        ) : null}
        {onFuelHistory ? (
          <ListRow
            title={t("driver.fuelHistory.title")}
            onPress={onFuelHistory}
            trailing={<Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />}
            testID="profile-fuel-history"
          />
        ) : null}
        {onMyAccidents ? (
          <ListRow
            title={t("driver.accident.myAccidents")}
            onPress={onMyAccidents}
            trailing={<Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />}
            testID="profile-my-accidents"
          />
        ) : null}
        <ListRow
          title={t("driver.profile.documents")}
          onPress={onDocuments}
          trailing={<Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          testID="profile-documents"
        />
        {onTraining ? (
          <ListRow
            title={t("driver.profile.training")}
            subtitle={t("driver.profile.trainingHint")}
            onPress={onTraining}
            trailing={<Icon name="school" size={theme.sizing.iconMd} color={theme.colors.primary} />}
            testID="profile-training"
          />
        ) : null}
        {onRoleSwitch ? (
          <ListRow
            title={t("driver.profile.switchRole")}
            subtitle={t("driver.profile.switchRoleHint")}
            onPress={onRoleSwitch}
            trailing={<Icon name="swap_horiz" size={theme.sizing.iconMd} color={theme.colors.primary} />}
            testID="profile-role-switch"
          />
        ) : null}
      </Card>

      {/* Language */}
      <Card variant="container" testID="profile-language">
        <Text preset="label" color={theme.colors.onSurfaceVariant}>
          {t("common.language")}
        </Text>
        <View style={{ flexDirection: "row", gap: theme.spacing[3], marginTop: theme.spacing[3] }}>
          {availableLocales().map((l) => (
            <View key={l} style={{ flex: 1 }}>
              <Button
                variant={l === locale ? "primary" : "secondary"}
                onPress={() => onSwitchLocale(l)}
                label={l === "en" ? t("common.english") : t("common.swahili")}
                testID={`profile-locale-${l}`}
              />
            </View>
          ))}
        </View>
      </Card>

      <Button variant="danger" onPress={onLogout} label={t("auth.logOut")} testID="profile-logout" />
      <View style={{ marginTop: theme.spacing[3] }}>
        <Button variant="ghost" onPress={onBack} label={t("common.back")} testID="profile-back" />
      </View>
    </ScrollView>
  )
}
