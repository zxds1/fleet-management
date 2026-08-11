// packages/mobile/src/screens/auth/ConsentScreen.tsx
import React from "react";
import { View, ScrollView } from "react-native";
import { Text } from "@/design/components/Text";
import { Button } from "@/design/components/Button";
import { Card } from "@/design/components/Card";
import { theme } from "@/design/theme";
import { t } from "@/core/i18n";

export interface ConsentScreenProps {
  version: string
  onAccept: () => void
  onDecline: () => void
}

export function ConsentScreen({ version, onAccept, onDecline }: ConsentScreenProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.ui01 }}
      contentContainerStyle={{ padding: theme.spacing[5], flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      testID="consent-screen"
    >
      <Text preset="heading03" style={{ marginBottom: theme.spacing[3] }}>
        {t("consent.title")}
      </Text>
      <Card>
        <Text style={{ color: theme.colors.textSecondary }}>{t("consent.body")}</Text>
        <Text style={{ marginTop: theme.spacing[3], color: theme.colors.textSecondary }}>
          {t("consent.policyVersion", { version })}
        </Text>
      </Card>
      <View style={{ marginTop: theme.spacing[5] }}>
        <Button onPress={onAccept} testID="consent-accept">
          {t("consent.accept")}
        </Button>
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button variant="secondary" onPress={onDecline} testID="consent-decline">
            {t("consent.decline")}
          </Button>
        </View>
      </View>
    </ScrollView>
  )
}
