// packages/mobile/src/screens/driver/RoleSwitchScreen.tsx
//
// A.2 Role Switch. Shown when the Principal holds both driver-scoped and admin-scoped permissions:
// two large cards mount either root navigator, plus the locale toggle (D-10).
//
// The screen is presentational: picking a card calls `onSwitch(role)`, which the routers thread up
// to `App.tsx`. `App` owns the `role` state that decides whether `DriverRouter` or `AdminRouter` is
// mounted, so selecting the other role genuinely remounts the other root surface rather than just
// returning to the current hub. `onDriver` / `onAdmin` remain as optional per-card overrides for
// callers that want to intercept one branch (they run *in addition to* `onSwitch`).

import React from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { theme } from "@/design/theme"
import { t, availableLocales, type Locale } from "@/core/i18n"

/** The two root surfaces `App.tsx` can mount. Mirrors the `role` state in `App`. */
export type AppRole = "driver" | "admin"

export interface RoleSwitchScreenProps {
  /** Mounts the chosen root navigator (wired to `setRole` + `setStep("authed")` in `App.tsx`). */
  onSwitch: (role: AppRole) => void
  /** Optional extra handling for the driver card (e.g. closing a sub-screen first). */
  onDriver?: () => void
  /** Optional extra handling for the admin card. */
  onAdmin?: () => void
  /** Hides the admin card when the principal holds no admin role. */
  canSwitchToAdmin?: boolean
  /** The role currently mounted — its card is marked as the active one. */
  currentRole?: AppRole
  locale: Locale
  onSwitchLocale: (locale: Locale) => void
}

export function RoleSwitchScreen({
  onSwitch,
  onDriver,
  onAdmin,
  canSwitchToAdmin = true,
  currentRole,
  locale,
  onSwitchLocale,
}: RoleSwitchScreenProps) {
  const pick = (role: AppRole) => {
    if (role === "driver") onDriver?.()
    else onAdmin?.()
    onSwitch(role)
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: theme.spacing[5] }} testID="role-switch-screen">
      <Text preset="heading03" style={{ marginTop: theme.spacing[5] }}>
        {t("roleSwitch.title")}
      </Text>
      <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
        {t("roleSwitch.subtitle")}
      </Text>

      <View style={{ marginTop: theme.spacing[5] }}>
        <Card variant="container" onPress={() => pick("driver")} testID="role-switch-driver" accent={theme.colors.primary}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[4] }}>
            <Icon name="local_shipping" size={32} color={theme.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text preset="title">{t("roleSwitch.driver")}</Text>
              <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
                {currentRole === "driver" ? t("roleSwitch.current") : t("roleSwitch.driverDescription")}
              </Text>
            </View>
            <Icon name="chevron_right" size={theme.sizing.iconLg} color={theme.colors.primary} />
          </View>
        </Card>

        {canSwitchToAdmin ? (
          <Card variant="container" onPress={() => pick("admin")} testID="role-switch-admin" accent={theme.colors.primary}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[4] }}>
              <Icon name="dashboard" size={32} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text preset="title">{t("roleSwitch.admin")}</Text>
                <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
                  {currentRole === "admin" ? t("roleSwitch.current") : t("roleSwitch.adminDescription")}
                </Text>
              </View>
              <Icon name="chevron_right" size={theme.sizing.iconLg} color={theme.colors.primary} />
            </View>
          </Card>
        ) : null}
      </View>

      <View style={{ marginTop: theme.spacing[5] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[3] }}>
          <Icon name="language" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("common.language")}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[3] }}>
          {availableLocales().map((l) => (
            <View key={l} style={{ flex: 1 }}>
              <Button
                variant={l === locale ? "primary" : "secondary"}
                onPress={() => onSwitchLocale(l)}
                label={l === "en" ? t("common.english") : t("common.swahili")}
                testID={`role-switch-locale-${l}`}
              />
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  )
}
