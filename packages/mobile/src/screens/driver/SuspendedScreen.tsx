// packages/mobile/src/screens/driver/SuspendedScreen.tsx
//
// B.22 Suspended. Terminal screen reached from a login/refresh `ACCOUNT_SUSPENDED`. The only
// affordance is Log out — no further navigation is offered.

import React from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"

export interface SuspendedScreenProps {
  onLogout: () => void
}

export function SuspendedScreen({ onLogout }: SuspendedScreenProps) {
  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, padding: theme.spacing[5], justifyContent: "center" }}
      testID="suspended-screen"
    >
      <View style={{ alignItems: "center", marginBottom: theme.spacing[5] }}>
        <Icon name="gpp_good" size={48} color={theme.colors.error} />
      </View>

      <Card variant="container" accent={theme.colors.supportError} testID="suspended-card">
        <Text preset="heading02" align="center">
          {t("suspended.title")}
        </Text>
        <Text
          preset="body02"
          color={theme.colors.onSurfaceVariant}
          align="center"
          style={{ marginTop: theme.spacing[3] }}
        >
          {t("errors.ACCOUNT_SUSPENDED")}
        </Text>
        <Text
          preset="caption"
          color={theme.colors.onSurfaceVariant}
          align="center"
          style={{ marginTop: theme.spacing[2] }}
        >
          {t("suspended.body")}
        </Text>
      </Card>

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button
          variant="danger"
          onPress={onLogout}
          icon={<Icon name="logout" size={theme.sizing.iconMd} color={theme.colors.onError} />}
          label={t("auth.logOut")}
          testID="suspended-logout"
        />
      </View>
    </ScrollView>
  )
}
